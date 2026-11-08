# Yozora · PMVHaven (Browse)

18+ **custom-source** extension for seanime: browse-first PMV browsing from
[PMVHaven](https://pmvhaven.com) via the platform's own public keyless feed API.

- Feed: `GET /api/videos?tags=pmv&limit=&page=&sort=` — the exact endpoint the
  site's web player uses (verified 200, keyless).
- Covers, uploaders, view counts and durations included.
- Text search is **honestly refused** — `/api/search` is key-gated (401)
  upstream; nothing is faked.
- Playback: open an entry and select the `Yozora · PMVHaven` onlinestream
  provider; streams resolve to the platform's own OVH-hosted MP4s.

No auth, DRM or paywall is touched. Ported from Yozora's verified live adapter.
