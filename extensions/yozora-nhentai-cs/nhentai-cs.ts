/*!
 * Yozora custom source for seanime — nhentai (browse-first manga)
 *
 * 18+ content. Ported from Yozora's verified live adapter (2026-11, keyless):
 *  - GET https://nhentai.net/api/v2/galleries?page=1&per_page=24 → 200 JSON
 *  - Search: /api/v2/galleries?query={q}&page={N}&per_page=24
 *  - Popular: /api/v2/galleries/popular
 *  - Detail: /api/v2/galleries/{id}
 *  - /cdn → { image_servers:[...], thumb_servers:[...] }
 *  Gallery IDs are numeric upstream — they map 1:1 into the local ID space.
 *
 * seanime custom-source contract: global `class Provider`. Gallery IDs are
 * numeric upstream — they map 1:1 into the local ID space.
 */

const BASE = "https://nhentai.net/api/v2"
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

type NhTag = { id?: number; name?: string; type?: string; url?: string }
type NhTitle = { english?: string; japanese?: string; pretty?: string }
type NhImage = { path?: string }
type NhGallery = {
  id: number
  title?: NhTitle
  english_title?: string
  japanese_title?: string
  cover?: NhImage
  thumbnail?: string | NhImage
  tags?: NhTag[]
  num_pages?: number
  num_favorites?: number
  upload_date?: number
  release_date?: string
}

let serversCache: { images: string[]; thumbs: string[]; at: number } | null = null

async function getJson(url: string): Promise<Record<string, unknown>> {
  // YOZORA: bound each request to 8s and retry once. Without this, one
  // transient upstream blip (rate-limit response after a listing fetch,
  // one-shot 5xx) zeroed out gallery metadata and chapter resolution.
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": BROWSER_UA, Referer: "https://nhentai.net/" },
        timeout: 8000,
      })
      if (res.status >= 400) {
        throw ("nhentai-cs: upstream answered HTTP " + res.status + " for " + url)
      }
      return res.json()
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

async function servers(): Promise<{ images: string[]; thumbs: string[] }> {
  const now = Date.now()
  if (serversCache && now - serversCache.at < 3600_000) return serversCache
  try {
    const j = (await getJson(BASE + "/cdn")) as Record<string, unknown>
    const images = (j["image_servers"] as string[]) || []
    const thumbs = (j["thumb_servers"] as string[]) || []
    serversCache = {
      images: images.length ? images : ["https://i.nhentai.net"],
      thumbs: thumbs.length ? thumbs : ["https://t.nhentai.net"],
      at: now,
    }
  } catch (e) {
    serversCache = { images: ["https://i.nhentai.net"], thumbs: ["https://t.nhentai.net"], at: now }
  }
  return serversCache
}

function titleOf(g: NhGallery): string {
  if (g.title && (g.title.english || g.title.japanese || g.title.pretty)) {
    return g.title.english || g.title.japanese || g.title.pretty || ""
  }
  return g.english_title || g.japanese_title || "Gallery " + g.id
}

function tagNames(g: NhGallery, type?: string): string[] {
  const out: string[] = []
  const tags = g.tags || []
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i]
    if (t && t.name && (!type || t.type === type)) out.push(t.name)
  }
  return out
}

function coverOf(g: NhGallery, thumbs: string[]): string | null {
  let coverPath: string | null = null
  if (typeof g.thumbnail === "string") coverPath = g.thumbnail
  else if (g.thumbnail && g.thumbnail.path) coverPath = g.thumbnail.path
  else if (g.cover && g.cover.path) coverPath = g.cover.path
  if (!coverPath) return null
  return thumbs[0] + "/" + coverPath.replace(/^\/+/, "")
}

function baseManga(g: NhGallery, extra: Record<string, unknown> | null): Record<string, unknown> {
  const title = titleOf(g)
  const media: Record<string, unknown> = {
    id: g.id, // numeric upstream id — inside the local id space
    idMal: null,
    title: {
      romaji: title,
      english: title,
      native: g.title ? g.title.japanese || null : null,
      userPreferred: title,
    },
    coverImage: { extraLarge: null, large: null, medium: null, color: null },
    bannerImage: null,
    // YOZORA: the Go BaseManga contract only accepts the AniList MediaFormat
    // enum ("MANGA" etc.). nhentai category tags ("manga", "doujin", …) are
    // NOT valid enum values — passing them through made the server fail the
    // whole gallery unmarshal ("manga is not a valid MediaFormat"), zeroing
    // out getManga metadata. The upstream category stays visible in genres.
    format: "MANGA",
    status: "FINISHED",
    description: title,
    genres: [tagNames(g, "category")[0] || "manga"].concat(tagNames(g, "tag").slice(0, 12)),
    isAdult: true,
    chapters: g.num_pages || null,
    volumes: null,
    seasonYear: g.upload_date ? new Date(g.upload_date * 1000).getUTCFullYear() : null,
    averageScore: null,
    popularity: typeof g.num_favorites === "number" ? g.num_favorites : null,
    countryOfOrigin: "JP",
    siteUrl: "https://nhentai.net/g/" + g.id + "/",
    staff: { edges: [] },
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

async function withCovers(list: NhGallery[]): Promise<Record<string, unknown>[]> {
  const s = await servers()
  const out: Record<string, unknown>[] = []
  for (let i = 0; i < list.length; i++) {
    const g = list[i]
    const cover = coverOf(g, s.thumbs)
    out.push(baseManga(g, { coverImage: { extraLarge: cover, large: cover, medium: cover, color: null } }))
  }
  return out
}

async function fetchList(url: string): Promise<NhGallery[]> {
  const j = (await getJson(url)) as Record<string, unknown>
  const result = (j["result"] as NhGallery[]) || (j["galleries"] as NhGallery[]) || []
  return result
}

class Provider {
  async getSettings(): Promise<Record<string, boolean>> {
    return { supportsAnime: false, supportsManga: true }
  }

  async listManga(search: string, page: number, perPage: number): Promise<Record<string, unknown>> {
    const p = Math.max(1, page || 1)
    let url: string
    if (search && search.trim().length > 0) {
      url = BASE + "/galleries?query=" + encodeURIComponent(search.trim()) + "&page=" + p + "&per_page=24"
    } else {
      url = BASE + "/galleries?page=" + p + "&per_page=24"
    }
    const list = await fetchList(url)
    if (list.length === 0) {
      throw ("nhentai-cs: page " + p + " returned no galleries")
    }
    const media = await withCovers(list)
    return { media: media, page: p, totalPages: list.length >= 24 ? p + 1 : p, total: list.length }
  }

  async getManga(ids: number[]): Promise<Record<string, unknown>[]> {
    const s = await servers()
    const out: Record<string, unknown>[] = []
    for (let i = 0; i < ids.length; i++) {
      try {
        const j = (await getJson(BASE + "/galleries/" + ids[i])) as Record<string, unknown>
        const g = ((j["gallery"] as NhGallery) || j) as NhGallery
        if (g && g.id) {
          const cover = coverOf(g, s.thumbs)
          out.push(baseManga(g, { coverImage: { extraLarge: cover, large: cover, medium: cover, color: null } }))
        }
      } catch (e) {
        // skip unreachable gallery
      }
    }
    return out
  }

  async getMangaDetails(id: number): Promise<Record<string, unknown> | null> {
    const list = await this.getManga([id])
    return list.length > 0 ? list[0] : null
  }

  async listAnime(search: string, page: number, perPage: number): Promise<Record<string, unknown>> {
    throw ("nhentai-cs is manga-only (honest refusal)")
  }

  async getAnime(ids: number[]): Promise<Record<string, unknown>[]> {
    throw ("nhentai-cs is manga-only (honest refusal)")
  }

  async getAnimeDetails(id: number): Promise<null> {
    throw ("nhentai-cs is manga-only (honest refusal)")
  }

  async getAnimeWithRelations(id: number): Promise<null> {
    throw ("nhentai-cs is manga-only (honest refusal)")
  }

  async getAnimeMetadata(id: number): Promise<null> {
    throw ("nhentai-cs is manga-only (honest refusal)")
  }
}
