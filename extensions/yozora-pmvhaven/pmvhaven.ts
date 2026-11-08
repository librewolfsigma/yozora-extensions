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
  const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA } })
  if (res.status >= 400) {
    throw new Error("pmvhaven: upstream answered HTTP " + res.status + " for " + url)
  }
  return JSON.parse(res.text())
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
async function findVideo(id: string): Promise<PmvVideo | null> {
  if (recent[id]) return recent[id]
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
    const id = episode && episode.id ? String(episode.id) : ""
    if (!id) throw new Error("pmvhaven: episode has no id")
    const v = await findVideo(id)
    if (!v || !v.videoUrl) {
      throw new Error(
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
