# Yozora Extensions for seanime

**18+ provider pack** for [seanime](https://github.com/5rahim/seanime) — the
source set of the **Yozora** project (a fork of seanime:
[librewolfsigma/yozora](https://github.com/librewolfsigma/yozora)).

Every extension is a plain TypeScript payload executed by seanime's embedded
extension runtime. No credentials, no DRM circumvention, no paywall bypass —
each provider uses the platform's own public endpoints and hands you the
platform's own files.

| Extension | Type | Search | Playback / Pages | Keyless |
|---|---|---|---|---|
| **Yozora · nhentai** | manga-provider | ✅ nhentai API v2 text search (+ popular on empty query) | ✅ galleries → chapters → real pages from `i*.nhentai.net` | ✅ |
| **Yozora · HentaiOcean** | onlinestream-provider | ✅ the site's own search | ✅ direct MP4 from `w*.hentaiocean.com` (site's own mirrors; third-party mirrors ignored) | ✅ |
| **Yozora · Iwara** | onlinestream-provider | ❌ refuses honestly (guest API ignores `search` upstream — re-verified 2026-11) | ✅ signed direct MP4 with quality variants | ✅ (guest scope) |
| **Yozora · PMVHaven** | onlinestream-provider | ⚠️ browse-by-tag (first word of your query is the tag — the platform's keyless API has no text search) | ✅ direct MP4 from the platform's OVH storage | ✅ |
| **Yozora · HMVmania** | onlinestream-provider | ❌ returns `[]` honestly (the site's WordPress search does not index video posts) | ✅ direct MP4 from `hmvmania.com/wp-content` (quality variants when a post bundles them) | ✅ |

All five were verified end-to-end (search → episodes/chapters → servers/pages →
HTTP `206 video/mp4` / `image/webp` Range probes) before publishing.

## Install (seanime desktop or server)

**Option A — custom marketplace** (updates automatically):
1. seanime → Settings → Extensions → Marketplace
2. Set a custom marketplace URL to:
   ```
   https://raw.githubusercontent.com/librewolfsigma/yozora-extensions/main/marketplace.json
   ```

**Option B — add repository** (install specific extensions):
1. seanime → Extensions → Add repository
2. Paste:
   ```
   https://raw.githubusercontent.com/librewolfsigma/yozora-extensions/main/repo.json
   ```

Both paths are the standard seanime extension mechanisms
(`/api/v1/extensions/external/install-repository` and the marketplace URL).

## Using the providers

- **nhentai** — Manga → search. Each gallery = one chapter.
- **HentaiOcean / PMVHaven** — any anime entry → *Watch online* → pick the
  provider → manual search.
- **Iwara / HMVmania** — these two platforms don't offer keyless text search,
  so use the manual-mapping path: paste a video URL (`iwara.tv/video/{id}`,
  `hmvmania.com/video/{slug}`) or bare id/slug when mapping an entry.

## Honest limitations

- Iwara: the guest API ignores the `search` parameter (verified twice, latest
  2026-11). In-app search therefore refuses instead of returning unrelated
  results. Explicit-rated content also depends on what Iwara serves to guests.
- HMVmania: the site's own search does not cover video posts — search returns
  an empty list by design, never fabricated results.
- PMVHaven: text search is key-gated upstream (`/api/search` → 401); the
  extension maps your query to a tag browse instead.
- nhentai's edge occasionally challenges non-browser TLS fingerprints. The
  extension presents a Chrome UA (seanime's fetch does the same by default);
  if a 403/503 slips through, it surfaces as an honest error — retry later.
- Stream availability is whatever each platform serves its own web player.

## Repository layout

```
marketplace.json           custom-marketplace manifest (array of extensions)
repo.json                  repository manifest ({urls:[...]})
extensions/<id>/           manifest json + payload .ts + icon + readme
index.json                 LEGACY format for the pre-seanime Yozora Next.js app
                           (kept until that app is retired; ignored by seanime)
```

## Verification

Payloads are exercised with a goja-faithful harness (transpiled TypeScript,
synchronous `text()`/`json()` response surface, Chrome UA) against the live
upstreams: search, episode/chapter resolution, and Range-probes of resolved
streams. The harness lives in the yozora build workspace and is re-run before
every version bump.

## License

Extensions: MIT. Seanime itself is GPL-3.0; the Yozora fork keeps that license.
