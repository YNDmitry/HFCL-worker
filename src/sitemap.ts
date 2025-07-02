import { Env } from "./types/env"
import { Entry, getMaps } from "./maps"

export async function rewriteSitemap(
  req: Request,
  url: string,
  env: Env,
  ctx: ExecutionContext,
) {
  const edge = caches.default
  const cacheKey = new Request(req.url, req)

  if (req.headers.get('Cache-Control') !== 'no-cache') {
    const hit = await edge.match(cacheKey)
    if (hit) return hit
  }

  const upstream = await fetch(url, { cf: { cacheTtl: 0 } })
  let xml = await upstream.text()

  xml = xml.replace(/<loc>\s+([^<>\s][^<>]*?)\s+<\/loc>/g, '<loc>$1</loc>')

  const maps = await getMaps(env)

  const replace = (kind: 'detail' | 'family', src: Record<string, Entry>) => {
    const re = new RegExp(`https://[^<"]+/products/${kind}/([^<"]+)`, 'g')
    xml = xml.replace(re, (_, slug) =>
      src[slug] ? `https://${env.WEBFLOW_ORIGIN}${src[slug].pretty}` : _
    )
  }

  replace('detail', maps.detail)
  replace('family', maps.family)

  const resp = new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=120',
    },
  })

  ctx.waitUntil(edge.put(cacheKey, resp.clone()).catch(() => {}))
  return resp
}
