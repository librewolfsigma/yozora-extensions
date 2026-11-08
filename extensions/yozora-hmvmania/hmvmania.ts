/*!
 * Yozora extension for seanime — HMVmania (onlinestream-provider)
 *
 * 18+ content. Ported from Yozora's verified live adapter (2026-11, keyless):
 *  - Video page /video/{slug}/: <h1> title, WP video playlist li with
 *    data-video-source="https://hmvmania.com/wp-content/uploads/....mp4"
 *    (direct MP4 on the site's own hosting), poster/cover image nearby,
 *    HMV maker at /author/{name}/.
 *  - Direct stream verified: the data-video-source MP4 is the site's own
 *    upload — no DRM, no third-party re-host, nothing bypassed.
 *  - VERIFIED: HMVmania's WordPress search does NOT index video posts
 *    (?s=… returns zero video cards) — text search is honestly unavailable
 *    and search() returns an empty list instead of unrelated results.
 *    The provider is playback-oriented: paste a video URL/id through manual
 *    mapping, or browse on the site and map by id.
 *
 * Seanime contract: global `class Provider` with search / findEpisodes /
 * findEpisodeServer / getSettings.
 */

const BASE = "https://hmvmania.com"
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

async function getText(url: string): Promise<string> {
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
        throw ("hmvmania: upstream answered HTTP " + res.status + " for " + url)
      }
      return res.text()
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

function match1(s: string, re: RegExp): string | null {
  const m = re.exec(s)
  return m ? m[1] : null
}

function htmlDecode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
}

/** Accept a bare slug or a full https://hmvmania.com/video/{slug}/ URL. */
function slugFromId(id: string): string {
  const trimmed = (id || "").trim()
  const m = trimmed.match(/hmvmania\.com\/video\/([^"#?\/]+)/)
  if (m) return m[1]
  return trimmed.replace(/^\/+|\/+$/g, "")
}

async function videoHtml(slug: string): Promise<string> {
  return getText(BASE + "/video/" + encodeURIComponent(slug) + "/")
}

function pageTitle(html: string): string | null {
  const t = match1(html, /<h1[^>]*>([\s\S]*?)<\/h1>/)
  if (!t) return null
  return htmlDecode(t.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim()
}

function posterOf(html: string): string | null {
  return (
    match1(html, /data-poster-source="([^"]+)"/) ||
    match1(html, /og:image" content="([^"]+)"/) ||
    match1(html, /(https:\/\/hmvmania\.com\/wp-content\/uploads\/[^\s"']+cover\.jpg)/)
  )
}

/** All data-video-source MP4s on the page (first = primary stream). */
function sourcesOf(html: string): string[] {
  const out: string[] = []
  const seen: Record<string, boolean> = {}
  const re = /data-video-source="([^"]+\.mp4[^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const url = htmlDecode(m[1])
    if (seen[url]) continue
    seen[url] = true
    out.push(url)
  }
  return out
}

class Provider {
  async search(opts: { query: string; dub: boolean; year: number }): Promise<any[]> {
    // VERIFIED: HMVmania's WordPress search does not cover video posts —
    // returning an empty list mirrors upstream truth (no unrelated results).
    void opts
    return []
  }

  async findEpisodes(id: string): Promise<any[]> {
    const slug = slugFromId(id)
    if (!slug) throw ("hmvmania: pass a video slug or a https://hmvmania.com/video/{slug}/ URL")
    const html = await videoHtml(slug)
    if (!html.includes("data-video-source") && !pageTitle(html)) {
      throw ("hmvmania: video page for " + slug + " looked empty")
    }
    return [
      {
        id: slug,
        number: 1,
        url: BASE + "/video/" + slug + "/",
        title: pageTitle(html) || slug.replace(/[-_]+/g, " "),
      },
    ]
  }

  async findEpisodeServer(episode: any, server: string): Promise<any> {
    const slug = slugFromId(episode && episode.id ? String(episode.id) : "")
    if (!slug) throw ("hmvmania: episode has no id")
    const html = await videoHtml(slug)
    const sources = sourcesOf(html)
    if (!sources.length) throw ("hmvmania: no direct MP4 found on " + slug)
    const videoSources: any[] = []
    for (let i = 0; i < sources.length; i++) {
      videoSources.push({
        url: sources[i],
        type: "mp4",
        quality: i === 0 ? "default" : "mirror " + (i + 1),
        subtitles: [],
      })
    }
    return {
      server: "default",
      headers: { Referer: BASE + "/", "User-Agent": BROWSER_UA },
      videoSources: videoSources,
    }
  }

  getSettings(): any {
    return { episodeServers: ["default"], supportsDub: false }
  }
}
