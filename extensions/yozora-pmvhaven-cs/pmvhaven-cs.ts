/*!
 * Yozora custom source for seanime — PMVHaven (browse-first)
 *
 * 18+ content. Ported from Yozora's verified live adapter (2026-11, keyless):
 *  - GET https://pmvhaven.com/api/videos?tags=pmv&limit=100&page=1&sort=views
 *    → 200 JSON {success, videos:[{_id,title,uploader,videoUrl,thumbnailUrl,
 *    duration,durationSeconds,views,...}], totalVideos, totalPages, hasNext}
 *  - tags= works for pmv / hmv / cosplay / <any tag>; sort= views|likes|newest
 *  - videoUrl is a plain MP4 on the platform's own OVH object storage.
 *  - /api/search, /api/video/{id}, /api/categories are key-gated (401) —
 *    text search is honestly refused; browse-by-tag is the keyless path.
 *
 * seanime custom-source contract: global `class Provider`. Entries are
 * played via an onlinestream-provider extension (yozora-pmvhaven) selected
 * on the entry page.
 */

const BASE = "https://pmvhaven.com"
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

type PmvVideo = {
  _id: string
  title: string
  uploader?: string
  videoUrl?: string
  thumbnailUrl?: string
  views?: number
  likes?: number
  duration?: string
  durationSeconds?: number
  tags?: string[]
}

/** hash(_id) -> video record (in-VM registry, self-heals by re-listing). */
const videoRegistry: Record<number, PmvVideo> = {}

function hashId(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return (h >>> 0) % 1099511627775 // stay inside the 40-bit local id space
}

function remember(v: PmvVideo): number {
  const id = hashId(v._id)
  videoRegistry[id] = v
  return id
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, Referer: BASE + "/" },
  })
  if (res.status >= 400) {
    throw ("pmvhaven-cs: upstream answered HTTP " + res.status + " for " + url)
  }
  return res.json()
}

function durationSec(v: PmvVideo): number | null {
  if (v.durationSeconds) return v.durationSeconds
  if (v.duration && v.duration.indexOf(":") >= 0) {
    const parts = v.duration.split(":")
    let s = 0
    for (let i = 0; i < parts.length; i++) s = s * 60 + Number(parts[i])
    return s
  }
  return null
}

function baseAnime(v: PmvVideo, extra: Record<string, unknown> | null): Record<string, unknown> {
  const id = remember(v)
  const tagList = v.tags && v.tags.length ? v.tags.slice(0, 4) : ["PMV"]
  const media: Record<string, unknown> = {
    id: id,
    idMal: null,
    title: {
      romaji: v.title,
      english: v.title,
      native: null,
      userPreferred: v.title,
    },
    coverImage: {
      extraLarge: v.thumbnailUrl || null,
      large: v.thumbnailUrl || null,
      medium: v.thumbnailUrl || null,
      color: null,
    },
    bannerImage: v.thumbnailUrl || null,
    format: "MOVIE",
    status: "FINISHED",
    description:
      "PMV by " + (v.uploader || "unknown uploader") + " — hosted on PMVHaven (" + tagList.join(", ") + ").",
    genres: tagList,
    isAdult: true,
    episodes: 1,
    duration: durationSec(v),
    seasonYear: null,
    averageScore: null,
    popularity: typeof v.views === "number" ? v.views : null,
    countryOfOrigin: null,
    siteUrl: BASE + "/video/" + v._id,
    studios: { nodes: v.uploader ? [{ name: v.uploader }] : [] },
    nextAiringEpisode: null,
    startDate: null,
    endDate: null,
  }
  if (extra) {
    const keys = Object.keys(extra)
    for (let i = 0; i < keys.length; i++) {
      media[keys[i]] = extra[keys[i]]
    }
  }
  return media
}

async function fetchFeed(tag: string, sort: string, page: number, perPage: number): Promise<PmvVideo[]> {
  const url =
    BASE +
    "/api/videos?tags=" +
    encodeURIComponent(tag) +
    "&limit=" +
    (perPage > 0 && perPage <= 100 ? perPage : 50) +
    "&page=" +
    Math.max(1, page || 1) +
    "&sort=" +
    (sort || "views")
  const j = await getJson(url)
  const videos = (j["videos"] as PmvVideo[]) || []
  return videos
}

/** Re-list page 1..3 to rebuild the registry after a server restart. */
async function healRegistry(): Promise<void> {
  for (let p = 1; p <= 3; p++) {
    try {
      const videos = await fetchFeed("pmv", "views", p, 50)
      for (let i = 0; i < videos.length; i++) remember(videos[i])
      if (videos.length < 10) break
    } catch (e) {
      return
    }
  }
}

class Provider {
  async getSettings(): Promise<Record<string, boolean>> {
    return { supportsAnime: true, supportsManga: false }
  }

  async listAnime(search: string, page: number, perPage: number): Promise<Record<string, unknown>> {
    if (search && search.trim().length > 0) {
      throw (
        "PMVHaven text search is key-gated upstream (/api/search 401) — browse the feeds instead (honest refusal, nothing faked)"
      )
    }
    const p = Math.max(1, page || 1)
    const videos = await fetchFeed("pmv", "views", p, perPage)
    if (videos.length === 0) {
      throw ("pmvhaven-cs: feed page " + p + " was empty")
    }
    const media: Record<string, unknown>[] = []
    for (let i = 0; i < videos.length; i++) media.push(baseAnime(videos[i], null))
    return { media: media, page: p, totalPages: videos.length >= 20 ? p + 1 : p, total: videos.length }
  }

  async getAnime(ids: number[]): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = []
    for (let i = 0; i < ids.length; i++) {
      let v = videoRegistry[ids[i]]
      if (!v) {
        await healRegistry()
        v = videoRegistry[ids[i]]
      }
      if (!v) continue
      out.push(baseAnime(v, null))
    }
    return out
  }

  async getAnimeWithRelations(id: number): Promise<Record<string, unknown>> {
    const list = await this.getAnime([id])
    const media =
      list.length > 0
        ? list[0]
        : baseAnime({ _id: String(id), title: "Unknown PMV" }, null)
    media["relations"] = { edges: [] }
    return media
  }

  async getAnimeMetadata(id: number): Promise<null> {
    return null
  }

  async getAnimeDetails(id: number): Promise<Record<string, unknown> | null> {
    const list = await this.getAnime([id])
    return list.length > 0 ? list[0] : null
  }

  async listManga(search: string, page: number, perPage: number): Promise<Record<string, unknown>> {
    throw ("pmvhaven-cs is anime-only (honest refusal)")
  }

  async getManga(ids: number[]): Promise<Record<string, unknown>[]> {
    throw ("pmvhaven-cs is anime-only (honest refusal)")
  }

  async getMangaDetails(id: number): Promise<null> {
    throw ("pmvhaven-cs is anime-only (honest refusal)")
  }
}
