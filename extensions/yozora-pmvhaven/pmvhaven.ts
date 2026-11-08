/*!
 * Yozora extension for seanime — PMVHaven (onlinestream-provider)
 *
 * 18+ content. Ported from Yozora's verified live adapter (2026-11, keyless):
 *  - GET https://pmvhaven.com/api/videos?tags={tag}&limit=24&page={n}&sort={s}
 *      → 200 JSON {success, videos:[{_id,title,uploader,videoUrl,thumbnailUrl,
 *        duration,durationSeconds,views,…}], totalVideos, totalPages, hasNext}
 *  - tags= works for pmv / hmv / cosplay / <any tag>; sort= views|likes|newest
 *  - videoUrl is a plain MP4 on the platform's OVH object storage.
 *  - /api/search and /api/video/{id} are key-gated (401) — "search" is
 *    therefore implemented as browse-by-tag: the first word of the query is
 *    used as the tag (PMVHaven tags are single words). This is exactly what
 *    the platform's keyless API offers; nothing is faked.
 *  - No auth, DRM or paywall is bypassed — these are the platform's own
 *    public endpoints its web player uses.
 *
 * Seanime contract: global `class Provider` with search / findEpisodes /
 * findEpisodeServer / getSettings.
 */

const BASE = "https://pmvhaven.com"
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

async function getJson(url: string): Promise<any> {
  // YOZORA (fork): bound each request to 8s and retry once so one transient
  // upstream stall cannot zero out metadata or streaming resolution.
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": BROWSER_UA, Referer: BASE + "/" },
        timeout: 8000,
      })
      if (res.status >= 400) {
        throw ("pmvhaven: upstream answered HTTP " + res.status + " for " + url)
      }
      return JSON.parse(res.text())
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

interface PmvVideo {
  _id: string
  title: string
  uploader?: string
  videoUrl?: string
  thumbnailUrl?: string
}

// Recent browse pages are memoized so findEpisodeServer() can resolve a known
// video id without the key-gated /api/video/{id} endpoint. Per-VM LRU.
const recent: Record<string, PmvVideo> = []
let recentOrder: string[] = []
function remember(vs: PmvVideo[]) {
  if (!vs) return
  for (const v of vs) {
    if (!v || !v._id) continue
    if (!recent[v._id]) {
      recentOrder.push(v._id)
      while (recentOrder.length > 600) {
        const drop = recentOrder.shift()
        if (drop) delete recent[drop]
      }
    }
    recent[v._id] = v
  }
}

async function browse(tag: string, page: number, sort: string): Promise<PmvVideo[]> {
  const j = await getJson(
    BASE + "/api/videos?tags=" + encodeURIComponent(tag) + "&limit=24&page=" + page + "&sort=" + sort,
  )
  const vs = (j && j.videos) || []
  remember(vs)
  return vs
}

/** Bounded scan of browse pages to locate a video the memo lost. */
// YOZORA (fork): episode ids can arrive as a bare id or a full video URL
// (custom source entries pass their page URL through as the episode id).
function videoIdFromAny(input: string): string {
  const s = String(input || "")
  const m = s.match(/([0-9a-f]{24})/i)
  if (m) return m[1]
  const parts = s.split("/").filter(Boolean)
  return parts[parts.length - 1] || s
}

// YOZORA (fork): resolve a video straight from its own public page (the MP4
// is embedded in the page's data). Deterministic and restart-proof — no
// reliance on the per-VM browse memo. Falls back to the browse scan.
async function findVideoByPage(id: string): Promise<PmvVideo | null> {
  id = videoIdFromAny(id)
  try {
    const res = await fetch(BASE + "/video/" + encodeURIComponent(id), {
      headers: { "User-Agent": BROWSER_UA, Referer: BASE + "/" },
      timeout: 8000,
    })
    if (res.status >= 400) return null
    const html = await res.text()
    const unescaped = html.split("\\u002F").join("/")
    const m =
      unescaped.match(/https:\/\/[a-z0-9.-]*cloud\.ovh\.net\/videos\/[^"'\\\s]+\.mp4/i) ||
      unescaped.match(/https:\/\/[^"'\\\s]*\/(?:videos|media)\/[^"'\\\s]+\.mp4/i)
    if (!m) return null
    const titleM = unescaped.match(/<meta property="og:title" content="([^"]+)"/)
    const v: PmvVideo = {
      _id: id,
      title: titleM ? titleM[1] : id,
      videoUrl: m[0],
    }
    remember([v])
    return v
  } catch (e) {
    return null
  }
}

async function findVideo(id: string): Promise<PmvVideo | null> {
  id = videoIdFromAny(id)
  if (recent[id]) return recent[id]
  const direct = await findVideoByPage(id)
  if (direct) return direct
  for (const tag of ["pmv", "hmv"]) {
    for (let p = 1; p <= 3; p++) {
      const vs = await browse(tag, p, "views").catch(() => [])
      if (recent[id]) return recent[id]
      void vs
    }
    if (recent[id]) return recent[id]
  }
  return null
}

class Provider {
  async search(opts: { query: string; dub: boolean; year: number }): Promise<any[]> {
    const query = (opts && opts.query ? opts.query : "").trim()
    // Keyless search = tag browse. Multi-word queries use the first word
    // (PMVHaven tags are single words).
    const tag = (query ? query.split(/\s+/)[0] : "pmv").toLowerCase() || "pmv"
    const vs = await browse(tag, 1, "views")
    const out: any[] = []
    for (const v of vs) {
      out.push({
        id: v._id,
        title: v.title || v._id,
        url: BASE + "/video/" + v._id,
        subOrDub: "sub",
      })
    }
    return out
  }

  async findEpisodes(id: string): Promise<any[]> {
    const v = await findVideo(id)
    return [
      {
        id: id,
        number: 1,
        url: BASE + "/video/" + id,
        title: v && v.title ? v.title : "PMV",
      },
    ]
  }

  async findEpisodeServer(episode: any, server: string): Promise<any> {
    const id = episode && episode.id ? videoIdFromAny(String(episode.id)) : ""
    if (!id) throw ("pmvhaven: episode has no id")
    const v = await findVideo(id)
    if (!v || !v.videoUrl) {
      throw (
        "pmvhaven: video " + id + " could not be located on the keyless browse API (its detail endpoint needs a platform key)",
      )
    }
    return {
      server: "default",
      headers: { "User-Agent": BROWSER_UA },
      videoSources: [
        {
          url: v.videoUrl,
          type: "mp4",
          quality: "default",
          subtitles: [],
        },
      ],
    }
  }

  getSettings(): any {
    return { episodeServers: ["default"], supportsDub: false }
  }
}
