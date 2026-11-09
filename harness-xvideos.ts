/**
 * Live harness for the xvideos extension payloads (bun run harness-xvideos.ts).
 * Exercises the same Provider contract the seanime runtime calls:
 *   onlinestream: search → findEpisodes → findEpisodeServer (+ byte-range probe)
 *   custom-source: getSettings → listAnime (feed + search) → getAnime
 * Anything red here must be fixed BEFORE publishing/installing.
 */

async function probe(url: string, referer: string): Promise<void> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Referer: referer, Range: "bytes=0-1023" },
    redirect: "follow",
  })
  const ct = res.headers.get("content-type") || "?"
  const cr = res.headers.get("content-range") || `${res.status}`
  await res.arrayBuffer()
  console.log(`    probe ${res.status} ${ct} ${cr.slice(0, 48)} ${url.slice(0, 90)}`)
}

async function loadProvider(path: string): Promise<any> {
  // Mimic the goja runtime: transpile TS→JS, evaluate as a script, read the
  // module-global `class Provider` (no ES module exports in payloads).
  const src = await Bun.file(path).text()
  const transpiler = new Bun.Transpiler({ loader: "ts" })
  const js = transpiler.transformSync(src)
  const C = new Function(`"use strict";\n${js}\n;return Provider;`)()
  return new C()
}

async function runOnlinestream(name: string, path: string, query: string) {
  console.log(`\n== ${name} (${path}) ==`)
  const p = await loadProvider(path)
  const results = await p.search({ query, dub: false, year: 0 })
  console.log(`  search("${query}"): ${results.length} results; first: ${JSON.stringify(results[0])?.slice(0, 140)}`)
  if (!results.length) throw new Error(`${name}: search returned zero results`)
  const eps = await p.findEpisodes(results[0].id)
  console.log(`  findEpisodes: ${eps.length} ep; title=${JSON.stringify(eps[0].title).slice(0, 110)}`)
  const server = await p.findEpisodeServer(eps[0], "default")
  console.log(`  findEpisodeServer: ${server.videoSources.length} sources; ${server.videoSources.map((v: any) => v.type + ":" + v.quality).join(", ")}`)
  await probe(server.videoSources[0].url, server.headers.Referer)
  // bare-id + garbage honesty
  try { await p.findEpisodes("https://www.xvideos.com/video.aaaaaaaaaaaa/") } catch (e) { console.log(`  garbage-id honest error: ${String(e).slice(0, 90)}`) }
}

async function runCustomSource(name: string, path: string, search: string) {
  console.log(`\n== ${name} (${path}) ==`)
  const p = await loadProvider(path)
  const settings = await p.getSettings()
  console.log(`  getSettings: ${JSON.stringify(settings)}`)
  const feed = await p.listAnime("", 1, 20)
  const media = (feed as any).media
  console.log(`  listAnime(feed p1): ${media.length} items; first: ${JSON.stringify(media[0]?.title).slice(0, 110)}`)
  console.log(`    cover: ${media[0]?.coverImage?.large?.slice(0, 90)}`)
  console.log(`    siteUrl: ${media[0]?.siteUrl?.slice(0, 110)}`)
  console.log(`    genres/isAdult: ${JSON.stringify(media[0]?.genres)} / ${media[0]?.isAdult}`)
  if (search) {
    const sr = await p.listAnime(search, 1, 20)
    console.log(`  listAnime(search="${search}"): ${(sr as any).media.length} items`)
  }
  const details = await p.getAnime([(media[0] as any).id])
  console.log(`  getAnime([id0]): ${details.length}; title=${JSON.stringify(details[0]?.title?.romaji).slice(0, 110)}`)
  // id-heal across a "restart" (fresh registry)
  const p2 = await loadProvider(path)
  const healed = await p2.getAnime([(media[0] as any).id])
  console.log(`  getAnime after registry reset (heal): ${healed.length} -> ${JSON.stringify(healed[0]?.title?.romaji).slice(0, 90)}`)
}

const q = process.argv[2] || "wife"
await runOnlinestream("xvideos (CORN)", "./extensions/yozora-xvideos/xvideos.ts", q)
await runOnlinestream("xvideosjp (AV)", "./extensions/yozora-xvideosjp/xvideosjp.ts", "japanese")
await runCustomSource("xvideos-cs (CORN browse)", "./extensions/yozora-xvideos-cs/xvideos-cs.ts", q)
await runCustomSource("xvideosjp-cs (AV browse)", "./extensions/yozora-xvideosjp-cs/xvideosjp-cs.ts", "japanese")
console.log("\nALL HARNESS CHECKS DONE")
