import { Env } from "./types/env"

export async function fetchAll(cid: string, env: Env) {
  const out: any[] = []
  for (let offset = 0;; offset += 100) {
    const r = await fetch(`${env.WEBFLOW_CMS_API}/collections/${cid}/items?limit=100&offset=${offset}`, {
	    headers: {
	    	Authorization: `Bearer ${env.WEBFLOW_API_TOKEN}`, 'accept-version': '1.0.0'
	    }
    })
    const j: any = await r.json()
    out.push(...j.items)
    if (j.items.length < 100) break
  }
  return out
}
