import { Env } from "./types/env"

export const CACHE_TTL = 86_400

export async function proxyAndCache(req: Request, url: string, ctx: ExecutionContext) {
  let upstream: Response
  try { upstream = await fetch(url, { headers: { 'User-Agent': 'Googlebot' } }) }
  catch { return new Response('Upstream fetch failed', { status: 502 }) }

  const resp = new Response(upstream.body, upstream)
  resp.headers.set(
    'Cache-Control',
    `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=31536000`,
  )

  if (req.method === 'GET' && resp.ok)
    ctx.waitUntil(caches.default.put(req, resp.clone()).catch(() => {}))

  return resp
}

export async function purge(urls: string[], env: Env) {
  await fetch(
    `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/purge_cache`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files: urls }),
    },
  )
}
