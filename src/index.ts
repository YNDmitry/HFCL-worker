export interface Env {
  WEBFLOW_API_TOKEN: string
  DETAIL_COLLECTION_ID: string
  FAMILY_COLLECTION_ID: string
  OVERVIEW_COLLECTION_ID: string
  WEBFLOW_ORIGIN: string
  PRODUCT_MAP: KVNamespace
  HOOK_SECRET: string
}

const API         = 'https://api.webflow.com/v2'
const HDR         = (t: string) => ({ Authorization: `Bearer ${t}`, 'accept-version': '1.0.0' })
const BASE        = '/products'
const CACHE_TTL   = 86_400   // 24 h
const MEMO_TTL    = 300_000  // 5 min
const SITEMAP_RE = /^\/sitemap.*\.xml(?:\.gz)?$/

type Entry = { pretty: string; real: string }
type Maps  = { detail: Record<string, Entry>; family: Record<string, Entry> }

let memo: Maps | null           = null
let memoAt                       = 0
let building: Promise<Maps>|null = null

export default <ExportedHandler<Env>>{
  async fetch(req, env, ctx) {
    const url  = new URL(req.url)
    const path = url.pathname
    const abs  = (p: string) => `https://${env.WEBFLOW_ORIGIN}${p}`
    const edge = caches.default

    if (path === '/__rebuild' && (req.method === 'POST' || req.method === 'GET')) {
      const urlKey = url.searchParams.get('key')
      const ok = urlKey === env.HOOK_SECRET ||
                 (req.method === 'POST' && await verifyWebhook(req, env.HOOK_SECRET))
      if (!ok) return new Response('Forbidden', { status: 403 })
      ctx.waitUntil(rebuildMaps(env))
      return new Response(null, { status: 204 })
    }

    if (SITEMAP_RE.test(path)) return rewriteSitemap(req, abs(path), env, ctx)

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

    if (/^\/products\/overview\/.+/.test(path))
      return proxyAndCache(req, abs(path), ctx)

    if (path.startsWith('/products/')) {
      const cached = await edge.match(req)
      if (cached) return cached

      const slug = path.split('/').pop()!
      const hit  = await findHit(env, slug)
      if (!hit) return new Response('Not found', { status: 404 })

      return proxyAndCache(req, abs(hit.real), ctx)
    }

    return new Response('Not handled', { status: 404 })
  }
}

export const scheduled: ExportedHandlerScheduledHandler<Env> = async (_e, env) => {
  await rebuildMaps(env)
}

/*──────── helpers ────────*/

const safeEq = (a: string, b: string) => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function verifyWebhook(req: Request, secret: string) {
  const ts  = req.headers.get('x-webflow-timestamp') ?? ''
  const sig = req.headers.get('x-webflow-signature') ?? ''
  if (!ts || !sig) return false
  const ageOk = Math.abs(Date.now() - Number(ts)) < 300_000
  if (!ageOk) return false

  const body = await req.clone().text()
  const key  = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac  = await crypto.subtle.sign('HMAC', key,
               new TextEncoder().encode(`${ts}:${body}`))
  const calc = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2,'0')).join('')
  return safeEq(calc, sig)
}

const slugOf = (i: any) => (i.slug?.trim() || i.fieldData?.slug?.trim() || '')

async function getMaps(env: Env): Promise<Maps> {
  if (memo && Date.now() - memoAt < MEMO_TTL) return memo
  const kv = await env.PRODUCT_MAP.get('maps', 'json')
  if (kv) { memo = kv; memoAt = Date.now(); return kv }
  return rebuildMaps(env)
}

async function findHit(env: Env, slug: string): Promise<Entry | null> {
  let maps = await getMaps(env)
  let hit  = maps.detail[slug] ?? maps.family[slug]
  if (hit) return hit
  await rebuildMaps(env)
  maps = memo!
  return maps.detail[slug] ?? maps.family[slug] ?? null
}

async function rebuildMaps(env: Env): Promise<Maps> {
  if (building) return building
  building = (async () => {
    const [ov,fam,det] = await Promise.all([
      fetchAll(env.OVERVIEW_COLLECTION_ID, env),
      fetchAll(env.FAMILY_COLLECTION_ID,   env),
      fetchAll(env.DETAIL_COLLECTION_ID,   env)
    ])

    const ovId2 : Record<string,string> = {}
    ov.forEach(o => { const s = slugOf(o); if (s) ovId2[o.id] = s })

    const famId2 = fam.reduce<Record<string,{slug:string,parent?:string}>>((a,f)=>{
      const s = slugOf(f); if (s) a[f.id] = { slug:s, parent:f.fieldData['belongs-to'] }; return a
    }, {})

    const chain = (fid?:string, acc:string[]=[]):string[] => {
      if(!fid) return acc
      const f=famId2[fid]; if(!f) return acc
      const p=f.parent
      if(p&&famId2[p])    return chain(p,[f.slug,...acc])
      if(p&&ovId2[p])     return [ovId2[p],f.slug,...acc]
      return [f.slug,...acc]
    }

    const family: Record<string,Entry> = {}
    fam.forEach(f=>{
      const s=slugOf(f); if(!s) return
      family[s]={ pretty:`${BASE}/${chain(f.id).join('/')}`, real:`/products/family/${s}` }
    })

    const detail: Record<string,Entry> = {}
    det.forEach(d=>{
      const s=slugOf(d); if(!s) return
      const pf=d.fieldData['product-family']
      const fid=Array.isArray(pf)?pf[0]:typeof pf==='string'?pf:pf?.id
      const path=fid?chain(fid):[]
      detail[s]={ pretty:path.length?`${BASE}/${path.join('/')}/${s}`:`${BASE}/${s}`, real:`/products/detail/${s}` }
    })

    const maps={detail,family}
    await env.PRODUCT_MAP.put('maps', JSON.stringify(maps), { expirationTtl: CACHE_TTL })
    memo=maps; memoAt=Date.now()
    return maps
  })()
  try { return await building } finally { building=null }
}

async function fetchAll(cid: string, env: Env) {
  const out:any[]=[]
  for (let offset=0;;offset+=100) {
    const r=await fetch(`${API}/collections/${cid}/items?limit=100&offset=${offset}`,{headers:HDR(env.WEBFLOW_API_TOKEN)})
    const j=await r.json(); out.push(...j.items); if(j.items.length<100) break
  }
  return out
}

async function proxyAndCache(req: Request, url: string, ctx: ExecutionContext) {
  let upstream: Response
  try {
    upstream = await fetch(url, { headers: { 'User-Agent': 'Googlebot' } })
  } catch {
    return new Response('Upstream fetch failed', { status: 502 })
  }

  const resp = new Response(upstream.body, upstream)
  resp.headers.set(
    'Cache-Control',
    `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=31536000`
  )

  if (req.method === 'GET' && resp.ok) {
    ctx.waitUntil(caches.default.put(req, resp.clone()).catch(() => {}))
  }

  return resp
}

async function rewriteSitemap(
  req: Request,
  url: string,
  env: Env,
  ctx: ExecutionContext
) {
  const edge     = caches.default
  const cacheKey = new Request(req.url, req)

  if (req.headers.get('Cache-Control') !== 'no-cache') {
    const hit = await edge.match(cacheKey)
    if (hit) return hit
  }

  const upstream = await fetch(url, { cf: { cacheTtl: 0 } })
  let   xml      = await upstream.text()
  const maps     = await getMaps(env)

  const apply = (kind: 'detail' | 'family', map: Record<string, Entry>) => {
    const re = new RegExp(`https://[^<"]+/products/${kind}/([^<"]+)`, 'g')
    xml = xml.replace(re, (_m, slug) => {
      const hit = map[slug as string]
      return hit ? `https://${env.WEBFLOW_ORIGIN}${hit.pretty}` : _m
    })
  }

  apply('detail', maps.detail)
  apply('family', maps.family)

  const resp = new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=31536000`,
    },
  })

  ctx.waitUntil(edge.put(cacheKey, resp.clone()).catch(() => {}))
  return resp
}
