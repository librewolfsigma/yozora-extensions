# Yozora · nhentai (Browse)

18+ **custom-source** extension for seanime: browse-first manga galleries from
[nhentai](https://nhentai.net) via the official public JSON API v2.

- Feed: `/api/v2/galleries?page=N` (paged), search: `?query=...`, covers and
  tags resolved via the documented `/cdn` thumbnail servers.
- Gallery IDs are numeric upstream and map 1:1 into seanime's local ID space.
- In-app reading happens through the `Yozora · nhentai` manga-provider
  extension (chapters/pages); this browse source lists and details galleries.

No auth, DRM or paywall is touched. Ported from Yozora's verified live adapter.
