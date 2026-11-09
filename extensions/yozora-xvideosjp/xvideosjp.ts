/*!
 * Yozora extension for seanime — XVideos JP · AV/JAV vertical (onlinestream-provider)
 *
 * 18+ content. Japanese-language vertical ("AV" slice) — xvideos.com/lang/jpn,
 * the biggest free JAV streaming section. Written 2026-11, verified live from
 * the runtime sandbox (keyless, no DRM touched):
 *  - Search: https://www.xvideos.com/?k={q}&lang=jpn&p={n} — real server-side
 *    search scoped to the Japanese vertical (lang/jpn + ?p= verified 200).
 *  - Listing cards: <div id="video_{eid}"> blocks with href="/video.{eid}/…",
 *    <p class="title"><a title="…">, lazy thumb data-src.
 *  - Video page: html5player.setVideoUrlHigh('…mp4') / setVideoUrlLow /
 *    setVideoHLS('…m3u8') — direct progressive MP4 on the site's own CDN
 *    (mp4-gcore.xvideos-cdn.com) plus adaptive HLS. Nothing re-hosted.
 *  - VERIFIED: bare https://www.xvideos.com/video.{eid}/ 404s — the full
 *    path from listing cards must be preserved (THUMBNUM → 0 normalized).
 *
 * Seanime contract: global `class Provider` with search / findEpisodes /
 * findEpisodeServer / getSettings.
 */

const BASE = "https://www.xvideos.com"
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

async function getText(url: string): Promise<string> {
  // Bound each request to 8s and retry once so one transient upstream stall
  // cannot zero out search or streaming resolution.
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": BROWSER_UA,
          Referer: BASE + "/lang/jpn",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: 8000,
      })
      if (res.status >= 400) {
        throw ("xvideos-av: upstream answered HTTP " + res.status + " for " + url)
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
    .replace(/&nbsp;/g, " ")
}

/** Canonicalize a listing href into an absolute video URL that xvideos serves. */
function normalizeVideoUrl(raw: string): string {
  let u = (raw || "").trim().replace(/&amp;/g, "&")
  if (u.startsWith("//")) u = "https:" + u
  if (u.startsWith("/")) u = BASE + u
  u = u.replace(/\/THUMBNUM\//g, "/0/")
  u = u.split("#")[0]
  return u
}

/** The site video id ("olkmlfv7768" in /video.olkmlfv7768/…), or null. */
function videoIdOf(url: string): string | null {
  return match1(url, /xvideos\.com\/video\.([a-z0-9]+)/i)
}

function titleFromUrl(url: string): string {
  const slug = match1(url, /\/video\.[a-z0-9]+\/(?:\d+\/\d+\/)?([^\/?#]+)/i)
  if (!slug) return "xvideos video"
  return htmlDecode(slug).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
}

type Card = { url: string; title: string; thumb: string | null }

/** Parse mozaique thumb-blocks into cards, deduped by video id. */
function parseCards(html: string): Card[] {
  const out: Card[] = []
  const seen: Record<string, boolean> = {}
  const chunks = html.split('<div id="video_')
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i]
    const href = match1(chunk, /href="(\/video\.[a-z0-9]+(?:\/[^"]*)?)"/i)
    if (!href) continue
    const url = normalizeVideoUrl(href)
    const vid = videoIdOf(url)
    if (!vid || seen[vid]) continue
    seen[vid] = true
    const titleMatch =
      match1(chunk, /<p class="title"><a[^>]*title="([^"]*)"/) ||
      match1(chunk, /<p class="title"><a[^>]*>([\s\S]*?)</)
    const thumb =
      match1(chunk, /data-src="(https:\/\/[^" ]+\.(?:jpg|jpeg|png|webp|gif))"/) ||
      match1(chunk, /data-sfwthumb="(https:\/\/[^" ]+\.(?:jpg|jpeg|png|webp|gif))"/)
    const title = titleMatch
      ? htmlDecode(titleMatch).replace(/\s+/g, " ").trim()
      : titleFromUrl(url)
    out.push({ url: url, title: title, thumb: thumb ? thumb : null })
  }
  return out
}

function feedUrl(page: number): string {
  const p = Math.max(1, page || 1)
  return p <= 1 ? BASE + "/lang/jpn" : BASE + "/lang/jpn?p=" + p
}

function searchUrl(query: string, page: number): string {
  return BASE + "/?k=" + encodeURIComponent(query.trim()) + "&lang=jpn&p=" + Math.max(1, page || 1)
}

/** Video-page stream URLs: progressive MP4 (high/low) and adaptive HLS. */
function streamsOf(html: string): { high: string | null; low: string | null; hls: string | null } {
  return {
    high: match1(html, /setVideoUrlHigh\('([^']+)'\)/),
    low: match1(html, /setVideoUrlLow\('([^']+)'\)/),
    hls: match1(html, /setVideoHLS\('([^']+)'\)/),
  }
}

class Provider {
  async search(opts: { query: string; dub: boolean; year: number }): Promise<any[]> {
    const query = (opts && opts.query ? opts.query : "").trim()
    if (!query) throw ("xvideos (AV): enter a search query (e.g. a JAV code like SIRO-5758, or browse the Discover 18+ feed)")
    const html = await getText(searchUrl(query, 1))
    const cards = parseCards(html)
    const out: any[] = []
    for (let i = 0; i < cards.length; i++) {
      out.push({
        id: cards[i].url,
        title: cards[i].title,
        url: cards[i].url,
        subOrDub: "sub",
      })
    }
    return out
  }

  async findEpisodes(id: string): Promise<any[]> {
    const url = normalizeVideoUrl(id)
    if (!videoIdOf(url)) throw ("xvideos (AV): pass a https://www.xvideos.com/video.{id}/… URL or a bare video id")
    let title: string | null = null
    try {
      const html = await getText(url)
      title = match1(html, /setVideoTitle\('([^']*)'\)/) || null
      if (title) title = htmlDecode(title)
    } catch (e) {
      // The listing URL itself is the source of truth; metadata is best-effort.
    }
    return [
      {
        id: url,
        number: 1,
        url: url,
        title: title || titleFromUrl(url),
      },
    ]
  }

  async findEpisodeServer(episode: any, server: string): Promise<any> {
    const url = normalizeVideoUrl(episode && episode.id ? String(episode.id) : "")
    if (!videoIdOf(url)) throw ("xvideos (AV): episode has no usable id")
    const html = await getText(url)
    const streams = streamsOf(html)
    if (!streams.high && !streams.low && !streams.hls) {
      throw ("xvideos (AV): no direct stream found on " + url + " — the page may have moved")
    }
    const videoSources: any[] = []
    if (streams.high) {
      videoSources.push({
        url: streams.high,
        type: "mp4",
        quality: "default",
        subtitles: [],
      })
    }
    if (streams.hls) {
      videoSources.push({
        url: streams.hls,
        type: "m3u8",
        quality: "adaptive",
        subtitles: [],
      })
    }
    if (streams.low) {
      videoSources.push({
        url: streams.low,
        type: "mp4",
        quality: "low",
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
