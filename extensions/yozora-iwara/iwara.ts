/*!
 * Yozora extension for seanime — Iwara (onlinestream-provider)
 *
 * 18+ content. Ported from Yozora's verified live adapter (2026-11, keyless
 * guest access):
 *  - GET https://api.iwara.tv/video/{id} → full object incl. `fileUrl`
 *  - fileUrl answers a JSON array of quality variants
 *    [{id, name:"360", src:{view:"//asta.iwara.tv/view?…&expires=…"}}] —
 *    the playable URL is https: + the src.view of the best variant.
 *  - Thumbnails: https://files.iwara.tv/image/thumbnail/{file.id}/thumbnail-{NN}.jpg
 *  - The guest (keyless) API ignores the `search` param — text search is NOT
 *    faked; searching throws with an actionable message. Explicit-rated
 *    videos need a platform account upstream; a guest sees what Iwara serves
 *    guests.
 *  - No login, DRM or paywall bypassed — these are the platform's own signed
 *    direct files.
 *
 * Seanime contract: global `class Provider` with search / findEpisodes /
 * findEpisodeServer / getSettings.
 */

const BASE = "https://api.iwara.tv"
const SITE = "https://www.iwara.tv"
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// Iwara's API/CDN requires a browser-like UA plus Referer/Origin — plain
// server UAs get Cloudflare 403 (verified in Yozora's adapter).
async function getJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      Referer: SITE + "/",
      Origin: SITE,
      Accept: "application/json",
    },
  })
  if (res.status === 403 || res.status === 503 || res.status === 429) {
    throw new Error("iwara: upstream answered HTTP " + res.status + " (edge challenge) — try again shortly")
  }
  if (res.status >= 400) {
    throw new Error("iwara: upstream answered HTTP " + res.status)
  }
  return JSON.parse(res.text())
}

function numericQuality(name: string): number {
  const n = parseInt(name || "0", 10)
  return isNaN(n) ? 0 : n
}

function absolute(url: string): string {
  if (url.indexOf("//") === 0) return "https:" + url
  return url
}

interface IwVideo {
  id: string
  title: string
  fileUrl?: string | null
  file?: { id?: string }
  thumbnail?: number
}

class Provider {
  async search(opts: { query: string; dub: boolean; year: number }): Promise<any[]> {
    const query = (opts && opts.query ? opts.query : "").trim()
    if (!query) throw new Error("iwara: enter a search query")
    // VERIFIED (2026-11): the guest (keyless) API ignores the `search` param
    // entirely — a nonsense query returns the same default listing. Text
    // search is honestly unavailable without a platform account, so the
    // extension refuses instead of returning unrelated results.
    throw new Error(
      "iwara: text search needs an Iwara account upstream (the guest API ignores it) — this provider cannot search keylessly",
    )
  }

  async findEpisodes(id: string): Promise<any[]> {
    const v: IwVideo = await getJson(BASE + "/video/" + encodeURIComponent(id))
    if (!v || !v.id) throw new Error("iwara: video " + id + " not found")
    return [
      {
        id: v.id,
        number: 1,
        url: SITE + "/video/" + v.id,
        title: v.title || id,
      },
    ]
  }

  async findEpisodeServer(episode: any, server: string): Promise<any> {
    const id = episode && episode.id ? String(episode.id) : ""
    if (!id) throw new Error("iwara: episode has no id")
    const v: IwVideo = await getJson(BASE + "/video/" + encodeURIComponent(id))
    if (!v || !v.fileUrl) throw new Error("iwara: no signed fileUrl returned for this video")

    // fileUrl → JSON array of quality variants
    const variants = await getJson(absolute(v.fileUrl))
    if (!variants || !variants.length) {
      throw new Error("iwara: fileUrl returned no stream variants")
    }
    let best: any = null
    for (const variant of variants) {
      if (!best || numericQuality(variant && variant.name) > numericQuality(best.name)) {
        best = variant
      }
    }
    const view = best && best.src ? best.src.view || best.src.download : null
    if (!view) throw new Error("iwara: no view/download URL in stream variants")

    const headers: Record<string, string> = {
      "User-Agent": BROWSER_UA,
      Referer: SITE + "/",
    }
    const sources: any[] = [
      {
        url: absolute(view),
        type: "mp4",
        quality: best && best.name ? best.name + "p" : "default",
        subtitles: [],
      },
    ]
    // Lower variants as fallback qualities
    for (const variant of variants) {
      if (!variant || !variant.src || variant === best) continue
      const vUrl = variant.src.view || variant.src.download
      if (!vUrl) continue
      sources.push({
        url: absolute(vUrl),
        type: "mp4",
        quality: variant.name ? variant.name + "p" : "alt",
        subtitles: [],
      })
    }
    return { server: "default", headers: headers, videoSources: sources }
  }

  getSettings(): any {
    return { episodeServers: ["default"], supportsDub: false }
  }
}
