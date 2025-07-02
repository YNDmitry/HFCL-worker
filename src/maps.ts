import { CACHE_TTL } from "./cache";
import { Env } from "./types/env";
import { slugOf } from "./utils";
import { fetchAll } from "./webflow";

export type Entry = { pretty: string; real: string }
export type Maps = { family: Record<string, Entry>; detail: Record<string, Entry> }

const MEMO_TTL = 300_000

let building: Promise<Maps> | null = null
let memoAt = 0
export let memo: Maps | null = null

export async function getMaps(env: Env) {
  if (memo && Date.now() - memoAt < MEMO_TTL) return memo
  const kv = await env.PRODUCT_MAP.get('maps', 'json') as Maps | null
  if (kv && kv.family && kv.detail) {
    memo = kv; memoAt = Date.now(); return kv
  }
  return rebuildMaps(env)
}

export async function rebuildMaps(env: Env): Promise<Maps> {
  if (building) return building
  building = (async () => {
    const [ov, fam, det] = await Promise.all([
      fetchAll(env.OVERVIEW_COLLECTION_ID, env),
      fetchAll(env.FAMILY_COLLECTION_ID, env),
      fetchAll(env.DETAIL_COLLECTION_ID, env),
    ])

    const ovId2: Record<string, string> = {}
    ov.forEach(o => { const s = slugOf(o); if (s) ovId2[o.id] = s })

    const refIds = (raw: any): string[] => {
      if (!raw) return []
      if (Array.isArray(raw)) return raw.map(v => typeof v === 'string' ? v : v?.id).filter(Boolean)
      if (typeof raw === 'string') return [raw]
      if (raw.id) return [raw.id]
      return []
    }

    type FamNode = { slug: string; parents: string[] }
    const famId2: Record<string, FamNode> = {}

    fam.forEach(f => {
      const slug = slugOf(f)
      if (slug) famId2[f.id] = { slug, parents: [] }
    })

    fam.forEach(f => {
      famId2[f.id].parents.push(...refIds(f.fieldData['belongs-to']))
    })

    fam.forEach(f => {
      refIds(f.fieldData['sub-families']).forEach(kidId => {
        if (!famId2[kidId]) return
        const p = famId2[kidId].parents
        if (p[0] !== f.id) p.unshift(f.id)
      })
    })

    ov.forEach(o => {
      refIds(o.fieldData['product-families']).forEach(fid => {
        if (famId2[fid] && !famId2[fid].parents.includes(o.id))
          famId2[fid].parents.push(o.id)
      })
    })

    /* inverse overview → extra products */
    const extraOf: Record<string, string> = {}
    ov.forEach(o => {
      refIds(o.fieldData['extra-products']).forEach(did => extraOf[did] = o.id)
    })

    const chain = (fid?: string, acc: string[] = []): string[] => {
      if (!fid) return acc
      const node = famId2[fid]
      if (!node) return acc
      for (const p of node.parents) {
        if (famId2[p]) return chain(p, [node.slug, ...acc])
      }
      for (const p of node.parents) {
        if (ovId2[p]) return [ovId2[p], node.slug, ...acc]
      }
      return [node.slug, ...acc]
    }

    const family: Record<string, Entry> = {}
    fam.forEach(f => {
      const slug = slugOf(f)
      if (!slug) return
      const path = chain(f.id)
      family[slug] = {
        pretty: `${env.BASE_PATH}/${path.join('/')}`,
        real  : `/products/family/${slug}`,
      }
    })

    const detail: Record<string, Entry> = {}
    det.forEach(d => {
      const slug = slugOf(d)
      if (!slug) return

      const fid  = refIds(d.fieldData['product-family'])[0]
      let   path = fid ? chain(fid) : []

      if (!path.length) {
        const ovId = extraOf[d.id]
        if (ovId && ovId2[ovId]) path = [ovId2[ovId]]
      }

      if (!path.length) {
        const buKeys = [
          'business-unit',
          'business-unit-2',
          'business unit',
          'business_unit',
          'businessUnit',
        ]
        for (const k of buKeys) {
          const buId = refIds(d.fieldData[k])[0]
          if (buId) {
            path = ovId2[buId] ? [ovId2[buId]] : [buId]
            break
          }
        }
      }

      detail[slug] = {
        pretty: `${env.BASE_PATH}/${path.join('/')}/${slug}`,
        real  : `/products/detail/${slug}`,
      }
    })

    const maps = { family, detail }
    await env.PRODUCT_MAP.put('maps', JSON.stringify(maps), { expirationTtl: CACHE_TTL })
    memo = maps
    memoAt = Date.now()
    return maps
  })()
  try   { return await building }
  finally { building = null }
}

export async function findHit(env: Env, slug: string) {
  let maps: Maps = await getMaps(env)
  let hit = maps.detail[slug] ?? maps.family[slug]
  if (hit) return hit
  await rebuildMaps(env)
  maps = memo!
  return maps.detail[slug] ?? maps.family[slug] ?? null
}
