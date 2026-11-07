# yozora-extensions

Upstream **extension repository** for [Yozora](https://github.com/librewolfsigma/yorozu) —
the universal 18+ media client.

This repo is consumed **live at runtime** by Yozora's extension sync
(`src/lib/providers/ext/repo.ts`, default URL:
`https://raw.githubusercontent.com/librewolfsigma/yozora-extensions/main/index.json`).
Providers added here appear in Yozora automatically — no app update, no code
deploy. A failed sync never breaks the client: the last-good manifest keeps
serving until a new valid one replaces it.

## Manifest format (v1)

`index.json` is a single atomic manifest:

```jsonc
{
  "manifestVersion": 1,
  "repoId": "yozora-extensions",
  "updated": "ISO-8601",
  "providers": [ /* ExtProviderDef[] — see below */ ]
}
```

## Extensions are DATA, never code

A provider entry is a **declarative recipe**: URL templates, regex field
extractors, JSON dot-paths and string replacements. Yozora's recipe engine
interprets recipes as exactly four operations — fetch, regex, dot-path,
replace — so a manifest can never execute anything in the client. Validation
is strict and whole-manifest: any unknown shape rejects the entire sync.

## Provider entry

| field | meaning |
| --- | --- |
| `id` | unique slug (used as `providerId` everywhere) |
| `category` | ANIME / MANGA / MANHWA / ILLUSTRATION / AV / GAME / DATABASE / SCRIPT / MISC |
| `capabilities` | honest capability list — the engine only implements what recipes declare |
| `mediaHosts` / `mediaHostSuffixes` | image/stream hosts added to Yozora's proxy allowlist **only while installed + synced** |
| `resilientMedia` | allow the curl fallback transport for this provider's media on TLS challenges |
| `recipe.search` / `recipe.popular` | listing recipes (`{q}` and `{page}` templates) |
| `recipe.details` | per-item recipe (`{id}` template) |
| `recipe.units` | gallery/chapter construction (page URL derivation + count field) |

### Recipe example (HentaiFox)

Pages are derived from the gallery cover URL — the site's own stable CDN
pattern — with the page count taken from the gallery page:

```json
"units": {
  "kind": "gallery",
  "pagesFrom": { "from": "cover", "search": "cover.jpg", "replace": "{n}.webp" },
  "countFrom": "pages"
}
```

## Contributing an extension

1. Verify the upstream against a **real network** (search, details, units,
   page images — every capability you declare).
2. Add the provider entry to `index.json`, bump `updated`.
3. Open a PR. On merge, every Yozora instance picks it up within one sync
   cycle (max 6h, or instantly via "Sync now" in Extensions).
