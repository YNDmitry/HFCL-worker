import { Env } from './types/env'
import { proxyAndCache, purge } from './cache'
import { findHit, getMaps, Maps, rebuildMaps } from './maps'
import { rewriteSitemap } from './sitemap'
import { json } from './utils'
import { fetchAll } from './webflow'
import { handleScheduled } from './scheduled'

export const SITEMAP_RE = /^\/sitemap.*\.xml(?:\.gz)?$/

export default <ExportedHandler<Env>>{
  async fetch(req, env: Env, ctx) {
    const url  = new URL(req.url)
    const path = url.pathname
    const abs  = (p: string) => `https://${env.WEBFLOW_ORIGIN}${p}`
    const edge = caches.default

    if (path === '/__rebuild' && (req.method === 'POST' || req.method === 'GET')) {
      const ok = url.searchParams.get('key') === env.HOOK_SECRET
      if (!ok) return new Response('Forbidden', { status: 403 })

      // 1. Rebuild map
      await rebuildMaps(env)
      const maps: Maps = await getMaps(env)

      // 2. canonical («correct») URLs
      const pretty = [
        ...Object.values(maps.family).map(e => `https://${env.WEBFLOW_ORIGIN}${e.pretty}`),
        ...Object.values(maps.detail).map(e => `https://${env.WEBFLOW_ORIGIN}${e.pretty}`),
      ]

      // 3. old flat URLs, to purge them from cache
      const flat = [
        ...Object.keys(maps.family).map(s => `https://${env.WEBFLOW_ORIGIN}${env.BASE_PATH}/${s}`),
        ...Object.keys(maps.detail).map(s => `https://${env.WEBFLOW_ORIGIN}${env.BASE_PATH}/${s}`),
      ]

      // 4. Site maps (gzip and plain)
      const sitemap = [
        `https://${env.WEBFLOW_ORIGIN}/sitemap.xml`,
        `https://${env.WEBFLOW_ORIGIN}/sitemap.xml.gz`,
      ]

      // 5. 1 call purge for list
      ctx.waitUntil(purge([...pretty, ...flat, ...sitemap], env))

      return new Response(null, { status: 204 })
    }

    if (path === '/__debug'     && req.method === 'GET') return json(await getMaps(env))
    if (path === '/__debug-raw' && req.method === 'GET') {
      const [ov, fam, det] = await Promise.all([
        fetchAll(env.OVERVIEW_COLLECTION_ID, env),
        fetchAll(env.FAMILY_COLLECTION_ID, env),
        fetchAll(env.DETAIL_COLLECTION_ID, env),
      ])
      return json({ overview: ov, family: fam, detail: det })
    }

    if (SITEMAP_RE.test(path))
      return rewriteSitemap(req, abs(path), env, ctx)

    const mDetail = path.match(/^\/products\/detail\/([^/]+)$/)
    if (mDetail) {
      const hit = (await getMaps(env)).detail[mDetail[1]]
      if (hit) return Response.redirect(abs(hit.pretty), 301)
    }

    const mFamily = path.match(/^\/products\/family\/([^/]+)$/)
    if (mFamily) {
      const hit = (await getMaps(env)).family[mFamily[1]]
      if (hit) return Response.redirect(abs(hit.pretty), 301)
    }

    const mOverview = path.match(/^\/products\/overview\/([^/]+)$/)
    if (mOverview)
      return Response.redirect(abs(`${env.BASE_PATH}/${mOverview[1]}`), 301)

    if (path.startsWith('/products/')) {
      const cached = await edge.match(req)
      if (cached) return cached

      const slug = path.split('/').pop()!
      const hit  = await findHit(env, slug)
      if (!hit) return new Response('Not found', { status: 404 })

      if (path !== hit.pretty) return Response.redirect(abs(hit.pretty), 301)

      return proxyAndCache(req, abs(hit.real), ctx)
    }

    return new Response('Not handled', { status: 404 })
  },
  scheduled: handleScheduled
}
