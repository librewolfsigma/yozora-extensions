/*!
 * Yozora extension for seanime — HentaiOcean (onlinestream-provider)
 *
 * 18+ content. Ported from Yozora's verified live adapter (2026-11, keyless):
 *  - Search: https://hentaiocean.com/?s={q} → /watch/{slug} links
 *  - Watch page: <h1> title
 *  - STREAMS: /embed/{slug} embeds `var jsondata = {…mirrors:[{mirrorurl}]…}`.
 *    A mirror like https://w1.hentaiocean.com/play?vid={filename}.mp4 is the
 *    site's own player page whose JS resolves src = {mirror-origin}/video/{vid}
 *    → verified 206 video/mp4 on Range. We resolve that URL and hand the
 *    player the direct stream. Third-party mirror hosts are ignored.
 *  - No auth, DRM or paywall bypassed; mirrors on third-party hosts unused.
 *
 * Seanime contract: global `class Provider` with search / findEpisodes /
 * findEpisodeServer / getSettings.
 */

const BASE = "https://hentaiocean.com"
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

async function getText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, Referer: BASE + "/" },
  })
  if (res.status >= 400) {
    throw new Error("hentaiocean: upstream answered HTTP " + res.status + " for " + url)
  }
  return res.text()
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

function slugTitle(slug: string): string {
  return htmlDecode(slug).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
}

/** Parse the site's own search HTML for /watch/{slug} links. */
async function siteSearch(query: string): Promise<string[]> {
  const html = await getText(BASE + "/?s=" + encodeURIComponent(query))
  const out: string[] = []
  const seen: Record<string, boolean> = {}
  const re = /href="https:\/\/hentaiocean\.com\/watch\/([^"'#?]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const slug = m[1]
    if (seen[slug]) continue
    seen[slug] = true
    out.push(slug)
  }
  return out
}

/**
 * Resolve the site's own direct MP4 from an embed page:
 * 1. /embed/{slug} inlines `var jsondata = {...}` with mirrors[]
 * 2. first mirror matching *.hentaiocean.com/play?vid={file} is the site's
 *    own player; its JS plays {mirror-origin}/video/{vid}
 */
async function resolveStreamUrl(slug: string): Promise<string> {
  const html = await getText(BASE + "/embed/" + encodeURIComponent(slug))
  const re = /"mirrorurl":"([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const mirror = m[1].replace(/\\\//g, "/")
    const pm = mirror.match(/^(https:\/\/[a-z0-9.]*hentaiocean\.com)\/play\?vid=(.+)$/i)
    if (!pm) continue // third-party mirrors (listeamed etc.) are ignored
    const origin = pm[1]
    const vid = pm[2].replace(/&amp;/g, "&")
    // The site's own player does BASE_VIDEO_URL + encodeURIComponent(vid) —
    // mirror it exactly (vid carries spaces/brackets).
    return origin + "/video/" + encodeURIComponent(vid)
  }
  throw new Error("hentaiocean: no direct hentaiocean.com play mirror resolved for " + slug)
}

async function watchTitle(slug: string): Promise<string | null> {
  try {
    const html = await getText(BASE + "/watch/" + encodeURIComponent(slug) + "/")
    const t = match1(html, /<h1[^>]*>([\s\S]*?)<\/h1>/)
    return t ? htmlDecode(t.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim() : null
  } catch (e) {
    return null // titles are enrichment — the slug still identifies the video
  }
}

class Provider {
  async search(opts: { query: string; dub: boolean; year: number }): Promise<any[]> {
    const query = (opts && opts.query ? opts.query : "").trim()
    if (!query) throw new Error("hentaiocean: enter a search query (e.g. a title or series name)")
    const slugs = await siteSearch(query)
    const out: any[] = []
    for (const slug of slugs) {
      out.push({
        id: slug,
        title: slugTitle(slug),
        url: BASE + "/watch/" + slug,
        subOrDub: "sub",
      })
    }
    return out
  }

  async findEpisodes(id: string): Promise<any[]> {
    const title = await watchTitle(id)
    return [
      {
        id: id,
        number: 1,
        url: BASE + "/watch/" + id,
        title: title || slugTitle(id),
      },
    ]
  }

  async findEpisodeServer(episode: any, server: string): Promise<any> {
    const slug = episode && episode.id ? String(episode.id) : ""
    if (!slug) throw new Error("hentaiocean: episode has no id")
    const streamUrl = await resolveStreamUrl(slug)
    return {
      server: "default",
      headers: { Referer: BASE + "/", "User-Agent": BROWSER_UA },
      videoSources: [
        {
          url: streamUrl,
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
