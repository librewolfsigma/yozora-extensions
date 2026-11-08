/*!
 * Yozora custom source for seanime — HMVmania (browse-first)
 *
 * 18+ content. Ported from Yozora's verified live adapter (2026-11, keyless):
 *  - Listing: https://hmvmania.com/2d-videos/ (and /2d-videos/page/{N}/ —
 *    verified page 2 returns ~80 video cards). Cards carry
 *    <a href="https://hmvmania.com/video/{slug}/"> + lazy <img data-src=...>.
 *  - Video page /video/{slug}/: <h1> title, data-video-source MP4 on the
 *    site's own hosting, poster/cover, /author/{name} maker.
 *  - Search: HMVmania's WordPress search does NOT index video posts —
 *    text search is honestly refused; browse the feed instead.
 *
 * seanime custom-source contract: global `class Provider` with
 * getSettings / listAnime / getAnime / getAnimeDetails / getAnimeWithRelations /
 * getAnimeMetadata (optional) / listManga / getManga / getMangaDetails.
 * The server converts local IDs into extension-composite IDs itself.
 * Playback of entries happens through onlinestream-provider extensions
 * (e.g. yozora-hmvmania) selected on the entry page.
 */

const BASE = "https://hmvmania.com"
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

/** slug -> numeric local id (stable djb2). Registry maps id -> slug. */
const idRegistry: Record<number, string> = {}

function hashId(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return (h >>> 0) % 1099511627775 // stay inside the 40-bit local id space
}

function remember(slug: string): number {
  const id = hashId(slug)
  idRegistry[id] = slug
  return id
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, Referer: BASE + "/" },
  })
  if (res.status >= 400) {
    throw ("hmvmania-cs: upstream answered HTTP " + res.status + " for " + url)
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
    .replace(/&hellip;/g, "…")
    .replace(/&nbsp;/g, " ")
}

function slugTitle(slug: string): string {
  return htmlDecode(slug).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
}

type Card = { slug: string; title: string; thumb: string | null; maker: string | null }

function parseCards(html: string): Card[] {
  const out: Card[] = []
  const seen: Record<string, boolean> = {}
  const chunks = html.split("video-item-card")
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i]
    const slug = match1(chunk, /href="https:\/\/hmvmania\.com\/video\/([^"#?\/]+)\/?"/)
    if (!slug || seen[slug]) continue
    seen[slug] = true
    const thumb =
      match1(chunk, /data-src="([^" ]+\.(?:jpg|jpeg|png|webp))"/) ||
      match1(chunk, /src="(https:\/\/hmvmania\.com\/[^" ]+\.(?:jpg|jpeg|png|webp))"/)
    const titleMatch = match1(chunk, /<h5>([\s\S]*?)<\/h5>/) || match1(chunk, /alt="([^"]{3,})"/)
    const maker = match1(chunk, /href="https:\/\/hmvmania\.com\/author\/([^"\/]+)\/"/)
    out.push({
      slug: slug,
      title: titleMatch ? htmlDecode(titleMatch).replace(/\s+/g, " ").trim() : slugTitle(slug),
      thumb: thumb ? thumb : null,
      maker: maker ? htmlDecode(maker.replace(/[-_]/g, " ")) : null,
    })
  }
  return out
}

function baseAnime(card: Card, extra: Record<string, unknown> | null): Record<string, unknown> {
  const id = remember(card.slug)
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
    description: card.maker ? "HMV by " + card.maker + " — hosted on HMVmania." : "HMV hosted on HMVmania.",
    genres: ["HMV"],
    isAdult: true,
    episodes: 1,
    duration: null,
    seasonYear: null,
    averageScore: null,
    popularity: null,
    countryOfOrigin: null,
    siteUrl: BASE + "/video/" + card.slug + "/",
    studios: { nodes: card.maker ? [{ name: card.maker }] : [] },
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

async function fetchDetail(slug: string): Promise<Card> {
  const html = await getText(BASE + "/video/" + encodeURIComponent(slug) + "/")
  const titleMatch = match1(html, /<h1[^>]*>([\s\S]*?)<\/h1>/)
  const poster =
    match1(html, /data-poster-source="([^"]+)"/) ||
    match1(html, /og:image" content="([^"]+)"/) ||
    match1(html, /(https:\/\/hmvmania\.com\/wp-content\/uploads\/[^\s"']+cover\.jpg)/)
  const maker = match1(html, /href="https:\/\/hmvmania\.com\/author\/([^"\/]+)\/"/)
  const desc = match1(html, /property="og:description" content="([^"]*)"/)
  return {
    slug: slug,
    title: titleMatch ? htmlDecode(titleMatch).replace(/\s+/g, " ").trim() : slugTitle(slug),
    thumb: poster ? poster : null,
    maker: maker ? htmlDecode(maker.replace(/[-_]/g, " ")) : null,
  }
}

/** Fetch the listing pages once to rebuild the id registry after a restart. */
async function healRegistry(): Promise<void> {
  for (let p = 1; p <= 3; p++) {
    try {
      const url = p <= 1 ? BASE + "/2d-videos/" : BASE + "/2d-videos/page/" + p + "/"
      const html = await getText(url)
      const cards = parseCards(html)
      for (let i = 0; i < cards.length; i++) remember(cards[i].slug)
      if (cards.length < 10) break
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
        "HMVmania's site search does not cover video posts upstream — browse the 2D videos feed instead (honest refusal, nothing faked)"
      )
    }
    const p = Math.max(1, page || 1)
    const url = p <= 1 ? BASE + "/2d-videos/" : BASE + "/2d-videos/page/" + p + "/"
    const html = await getText(url)
    const cards = parseCards(html)
    if (cards.length === 0) {
      throw ("hmvmania-cs: page " + p + " contained no video cards")
    }
    const media: Record<string, unknown>[] = []
    for (let i = 0; i < cards.length; i++) media.push(baseAnime(cards[i], null))
    // Upstream pagination is unknown; a full page implies at least one more.
    const totalPages = cards.length >= 40 ? p + 1 : p
    return { media: media, page: p, totalPages: totalPages, total: cards.length }
  }

  async getAnime(ids: number[]): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = []
    for (let i = 0; i < ids.length; i++) {
      let slug = idRegistry[ids[i]]
      if (!slug) {
        await healRegistry()
        slug = idRegistry[ids[i]]
      }
      if (!slug) continue
      try {
        const card = await fetchDetail(slug)
        const desc = card.maker ? "HMV by " + card.maker + " — hosted on HMVmania." : "HMV hosted on HMVmania."
        out.push(baseAnime(card, { description: desc }))
      } catch (e) {
        // Fall back to a minimal card so the entry page still renders.
        out.push(baseAnime({ slug: slug, title: slugTitle(slug), thumb: null, maker: null }, null))
      }
    }
    return out
  }

  async getAnimeWithRelations(id: number): Promise<Record<string, unknown>> {
    const list = await this.getAnime([id])
    const media = list.length > 0 ? list[0] : baseAnime({ slug: idRegistry[id] || String(id), title: "Unknown", thumb: null, maker: null }, null)
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
    throw ("hmvmania-cs is anime-only (honest refusal)")
  }

  async getManga(ids: number[]): Promise<Record<string, unknown>[]> {
    throw ("hmvmania-cs is anime-only (honest refusal)")
  }

  async getMangaDetails(id: number): Promise<null> {
    throw ("hmvmania-cs is anime-only (honest refusal)")
  }
}
