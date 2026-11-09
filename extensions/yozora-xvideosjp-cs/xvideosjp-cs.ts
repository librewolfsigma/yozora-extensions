/*!
 * Yozora custom source for seanime — XVideos JP · AV/JAV vertical (browse-first)
 *
 * 18+ content. Japanese-language vertical ("AV" slice) — xvideos.com/lang/jpn. Written 2026-11, verified
 * live from the runtime sandbox (keyless):
 *  - Feed: https://www.xvideos.com/ (+ /?p={n} pagination, verified 200).
 *  - Search: https://www.xvideos.com/?k={q}&p={n} — REAL server-side search
 *    (unlike hmvmania), verbatim pagination verified.
 *  - Cards: <div id="video_{eid}"> with href="/video.{eid}/…", <p class="title">
 *    <a title="…">, lazy thumb data-src. THUMBNUM hrefs normalized to /0/.
 *  - Video pages expose html5player.setVideoUrlHigh/Low (direct MP4 on the
 *    site's own CDN) + setVideoHLS — played back through the sibling
 *    onlinestream provider yozora-xvideos.
 *
 * seanime custom-source contract: global `class Provider` with
 * getSettings / listAnime / getAnime / getAnimeDetails / getAnimeWithRelations /
 * getAnimeMetadata (optional) / listManga / getManga / getMangaDetails.
 * The server converts local IDs into extension-composite IDs itself and passes
 * the entry's site URL to the playback provider as the episode id.
 */

const BASE = "https://www.xvideos.com"
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

/** normalized URL -> numeric local id (stable djb2). Registry maps id -> URL. */
const idRegistry: Record<number, string> = {}

function hashId(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return (h >>> 0) % 1099511627775 // stay inside the 40-bit local id space
}

function remember(url: string): number {
  const id = hashId(url)
  idRegistry[id] = url
  return id
}

async function getText(url: string): Promise<string> {
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
        throw ("xvideos-av-cs: upstream answered HTTP " + res.status + " for " + url)
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

function normalizeVideoUrl(raw: string): string {
  let u = (raw || "").trim().replace(/&amp;/g, "&")
  if (u.startsWith("//")) u = "https:" + u
  if (u.startsWith("/")) u = BASE + u
  u = u.replace(/\/THUMBNUM\//g, "/0/")
  u = u.split("#")[0]
  return u
}

function videoIdOf(url: string): string | null {
  return match1(url, /xvideos\.com\/video\.([a-z0-9]+)/i)
}

function titleFromUrl(url: string): string {
  const slug = match1(url, /\/video\.[a-z0-9]+\/(?:\d+\/\d+\/)?([^\/?#]+)/i)
  if (!slug) return "xvideos video"
  return htmlDecode(slug).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
}

type Card = { url: string; title: string; thumb: string | null }

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

function baseAnime(card: Card, extra: Record<string, unknown> | null): Record<string, unknown> {
  const id = remember(card.url)
  const media: Record<string, unknown> = {
    id: id,
    idMal: null,
    title: {
      romaji: card.title,
      english: card.title,
      native: null,
      userPreferred: card.title,
    },
    coverImage: {
      extraLarge: card.thumb,
      large: card.thumb,
      medium: card.thumb,
      color: null,
    },
    bannerImage: card.thumb,
    format: "MOVIE",
    status: "FINISHED",
    description: "JAV / Japanese AV video hosted on XVideos — plays through the Yozora XVideos JP provider.",
    genres: ["AV"],
    isAdult: true,
    episodes: 1,
    duration: null,
    seasonYear: null,
    averageScore: null,
    popularity: null,
    countryOfOrigin: null,
    siteUrl: card.url,
    studios: { nodes: [] },
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

/** Fetch the video page for real metadata (title/thumb/description). */
async function fetchDetail(url: string): Promise<Card> {
  const html = await getText(url)
  const titleMatch = match1(html, /setVideoTitle\('([^']*)'\)/)
  const thumb = match1(html, /setThumbUrl\('([^']+)'\)/) || match1(html, /og:image" content="([^"]+)"/)
  const desc = match1(html, /property="og:description" content="([^"]*)"/)
  return {
    url: url,
    title: titleMatch ? htmlDecode(titleMatch).replace(/\s+/g, " ").trim() : titleFromUrl(url),
    thumb: thumb ? thumb : null,
  }
}

/** Rebuild the id registry from feed pages after a restart. Resilient per-page. */
async function healRegistry(targetId?: number): Promise<boolean> {
  let found = false
  for (let p = 1; p <= 3; p++) {
    try {
      const html = await getText(feedUrl(p))
      const cards = parseCards(html)
      for (let i = 0; i < cards.length; i++) {
        const id = remember(cards[i].url)
        if (targetId !== undefined && id === targetId) found = true
      }
      if (found) return true
      if (cards.length < 10) return found
    } catch (e) {
      continue
    }
  }
  return found
}

class Provider {
  async getSettings(): Promise<Record<string, boolean>> {
    return { supportsAnime: true, supportsManga: false }
  }

  async listAnime(search: string, page: number, perPage: number): Promise<Record<string, unknown>> {
    void perPage
    const p = Math.max(1, page || 1)
    const q = (search || "").trim()
    const html = await getText(q ? searchUrl(q, p) : feedUrl(p))
    const cards = parseCards(html)
    if (cards.length === 0) {
      throw ("xvideos-av-cs: page " + p + (q ? " for search '" + q + "'" : "") + " contained no video cards")
    }
    const media: Record<string, unknown>[] = []
    for (let i = 0; i < cards.length; i++) media.push(baseAnime(cards[i], null))
    const totalPages = cards.length >= 20 ? p + 1 : p
    return { media: media, page: p, totalPages: totalPages, total: cards.length }
  }

  async getAnime(ids: number[]): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = []
    for (let i = 0; i < ids.length; i++) {
      let url = idRegistry[ids[i]]
      if (!url) {
        await healRegistry(ids[i])
        url = idRegistry[ids[i]]
      }
      if (!url) continue
      try {
        const card = await fetchDetail(url)
        out.push(baseAnime(card, { description: "JAV / Japanese AV video hosted on XVideos — plays through the Yozora XVideos JP provider." }))
      } catch (e) {
        // Fall back to a minimal card so the entry page still renders.
        out.push(baseAnime({ url: url, title: titleFromUrl(url), thumb: null }, null))
      }
    }
    return out
  }

  async getAnimeWithRelations(id: number): Promise<Record<string, unknown>> {
    const list = await this.getAnime([id])
    const media = list.length > 0 ? list[0] : baseAnime({ url: idRegistry[id] || "", title: "Unknown", thumb: null }, null)
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
    throw ("xvideos-av-cs is anime-only (honest refusal)")
  }

  async getManga(ids: number[]): Promise<Record<string, unknown>[]> {
    throw ("xvideos-av-cs is anime-only (honest refusal)")
  }

  async getMangaDetails(id: number): Promise<null> {
    throw ("xvideos-av-cs is anime-only (honest refusal)")
  }
}
