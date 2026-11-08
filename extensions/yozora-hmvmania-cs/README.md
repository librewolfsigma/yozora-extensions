# Yozora · HMVmania (Browse)

18+ **custom-source** extension for seanime: browse-first HMV browsing from
[HMVmania](https://hmvmania.com) — the dedicated HMV community site.

- Feed: the site's own public 2D videos index (`/2d-videos/`, paged).
- Covers, titles and makers parsed from the site's own card markup.
- Text search is **honestly refused** — HMVmania's WordPress search does not
  index video posts (verified upstream; nothing is faked).
- Playback: open an entry and select the `Yozora · HMVmania` onlinestream
  provider on the entry page; the episode resolves to the site's own hosted
  MP4 (`data-video-source`), played directly.

No auth, DRM or paywall is touched. Ported from Yozora's verified live adapter.
