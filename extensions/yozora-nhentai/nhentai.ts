/*!
 * Yozora extension for seanime — nhentai (manga-provider)
 *
 * 18+ content. Ported from Yozora's verified live adapter (2026-11, keyless):
 *  - GET https://nhentai.net/api/v2/galleries?page=1&per_page=24  → 200 JSON
 *    {result:[{id,media_id,title{english,japanese},cover,tags[],num_pages,…}],
 *     page, perPage, total, totalPages}
 *  - /galleries?query={q}&page={n} → same shape (text search)
 *  - /galleries/popular → one unpaged page of currently popular galleries
 *  - /galleries/{id} → full detail incl. pages[]:
 *        {number, path:"galleries/{media_id}/{n}.webp", width, height}
 *  - GET /cdn → {image_servers:["https://i1.nhentai.net",…],
 *                thumb_servers:["https://t1.nhentai.net",…]}
 *    → real page URL = image_server + "/" + page.path
 *
 * A single gallery reads as one chapter whose pages are the gallery pages.
 * Nothing is re-hosted: pages are fetched from the site's own image servers.
 * NOTE: nhentai's edge occasionally challenges non-browser TLS fingerprints;
 * seanime's extension fetch already presents a Chrome UA, which is what the
 * site's API expects. If a 403/503 slips through, retry later.
 *
 * Seanime contract: global `class Provider` (no imports/exports) with
 * search / findChapters / findChapterPages / getSettings.
 */

const BASE = "https://nhentai.net/api/v2"
const SITE = "https://nhentai.net"
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// The goja response exposes text() synchronously once the promise resolves.
async function getText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, Referer: SITE + "/" },
  })
  if (res.status === 403 || res.status === 503 || res.status === 429) {
    throw ("nhentai: upstream answered HTTP " + res.status + " (edge challenge) — try again shortly")
  }
  if (res.status >= 400) {
    throw ("nhentai: upstream answered HTTP " + res.status)
  }
  return res.text()
}

async function getJson(url: string): Promise<any> {
  return JSON.parse(await getText(url))
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

interface NhTag {
  id: number
  name: string
  type: string // tag | artist | group | parody | character | language | category
}

interface NhImage {
  path: string
}

interface NhGallery {
  id: number
  media_id: string
  // Detail shape: nested title{english,japanese,pretty}. LIST shape: flat
  // english_title / japanese_title (+ thumbnail path instead of cover).
  title?: { english: string | null; japanese: string | null; pretty: string | null }
  english_title?: string | null
  japanese_title?: string | null
  cover?: NhImage
  thumbnail?: NhImage | string
  pages?: NhImage[]
  tags?: NhTag[]
  num_pages?: number
  upload_date?: number
}

// CDN endpoints are stable but re-read occasionally (per-VM memo).
let serversCache: { at: number; images: string; thumbs: string } | null = null
async function servers(): Promise<{ images: string; thumbs: string }> {
  const now = Date.now()
  if (serversCache && now - serversCache.at < 30 * 60 * 1000) return serversCache
  let images = "https://i.nhentai.net"
  let thumbs = "https://t.nhentai.net"
  try {
    const j = await getJson(BASE + "/cdn")
    if (j && j.image_servers && j.image_servers.length) images = j.image_servers[0]
    if (j && j.thumb_servers && j.thumb_servers.length) thumbs = j.thumb_servers[0]
  } catch (e) {
    // Known-good defaults if the CDN endpoint is unreachable
  }
  serversCache = { at: now, images: images, thumbs: thumbs }
  return serversCache
}

function titleOf(g: NhGallery): string {
  if (g.title && (g.title.english || g.title.japanese || g.title.pretty)) {
    return g.title.english || g.title.japanese || g.title.pretty || ""
  }
  return g.english_title || g.japanese_title || "Gallery " + g.id
}

function coverPath(g: NhGallery): string | null {
  if (typeof g.thumbnail === "string") return g.thumbnail
  if (g.cover && g.cover.path) return g.cover.path
  if (g.thumbnail && g.thumbnail.path) return g.thumbnail.path
  return null
}

async function toSearchResult(g: NhGallery): Promise<any> {
  const s = await servers()
  const cp = coverPath(g)
  let year: number | undefined = undefined
  if (g.upload_date) {
    try {
      year = new Date(g.upload_date * 1000).getUTCFullYear()
    } catch (e) {
      year = undefined
    }
  }
  return {
    id: String(g.id),
    title: htmlDecode(titleOf(g)),
    year: year,
    image: cp ? s.thumbs + "/" + cp.replace(/^\/+/, "") : undefined,
    imageHeaders: { Referer: SITE + "/" },
  }
}

class Provider {
  async search(opts: { query: string; year?: number }): Promise<any[]> {
    const query = (opts && opts.query ? opts.query : "").trim()
    if (!query) {
      // Empty query → currently popular galleries (single unpaged page).
      try {
        const j = await getJson(BASE + "/galleries/popular")
        const list = (j.result || []).filter((g: NhGallery) => g && g.id != null)
        const out: any[] = []
        for (const g of list) out.push(await toSearchResult(g))
        if (out.length) return out
      } catch (e) {
        // fall through to newest-first
      }
      const j2 = await getJson(BASE + "/galleries?page=1&per_page=24")
      const list2 = (j2.result || []).filter((g: NhGallery) => g && g.id != null)
      const out2: any[] = []
      for (const g of list2) out2.push(await toSearchResult(g))
      return out2
    }
    const j = await getJson(
      BASE + "/galleries?query=" + encodeURIComponent(query) + "&page=1&per_page=24",
    )
    const list = (j.result || []).filter((g: NhGallery) => g && g.id != null)
    const out: any[] = []
    for (const g of list) out.push(await toSearchResult(g))
    return out
  }

  async findChapters(id: string): Promise<any[]> {
    const g = await getJson(BASE + "/galleries/" + encodeURIComponent(id))
    if (!g || g.id == null) throw ("nhentai: gallery " + id + " not found")
    return [
      {
        id: String(g.id),
        url: SITE + "/g/" + g.id + "/",
        title: htmlDecode(titleOf(g)),
        chapter: "1",
        index: 0,
        language: "multi",
      },
    ]
  }

  async findChapterPages(chapterId: string): Promise<any[]> {
    const g = await getJson(BASE + "/galleries/" + encodeURIComponent(chapterId))
    if (!g || !g.pages || !g.pages.length) {
      throw ("nhentai: gallery " + chapterId + " has no pages")
    }
    const s = await servers()
    const out: any[] = []
    for (let i = 0; i < g.pages.length; i++) {
      out.push({
        url: s.images + "/" + g.pages[i].path.replace(/^\/+/, ""),
        index: i,
        headers: { Referer: SITE + "/" },
      })
    }
    return out
  }

  getSettings(): any {
    return { supportsMultiLanguage: false, supportsMultiScanlator: false }
  }
}
