# Webflow → Cloudflare Worker Product Proxy

Small Worker that:

1. **Normalises product URLs** – keeps public paths clean (`/products/...`) while hiding Webflow slugs.
2. **Caches HTML at the edge** – 24 h in Cloudflare cache, 5 min in-memory memo.
3. **Rebuilds slug maps** on demand, cron, or secure Webflow webhook.

---

## Request flow
               ┌────────────┐
browser ──► Worker │ fetch() │ upstream HTML
└────────────┘
│
▼
KV PRODUCT_MAP (detail & family slug → pretty/real)

| Path pattern                         | Behaviour                                             |
| ------------------------------------ | ----------------------------------------------------- |
| `/products/detail/:slug`             | **301** → canonical pretty path                       |
| `/products/family/:slug`             | **301** → canonical pretty path                       |
| `/products/overview/**`              | proxy + edge-cache                                    |
| `/products/**`                       | resolve slug → proxy + edge-cache (or 404)            |
| `/__rebuild` (`GET`/`POST`)          | rebuild maps (auth required)                          |

---

## Environment variables (`Env` interface)

| Var                   | Description                                     |
| --------------------- | ----------------------------------------------- |
| `WEBFLOW_API_TOKEN`   | Webflow API v2 token                             |
| `DETAIL_COLLECTION_ID`<br>`FAMILY_COLLECTION_ID`<br>`OVERVIEW_COLLECTION_ID` | Webflow collection IDs |
| `WEBFLOW_ORIGIN`      | `<site>.webflow.io` origin (no protocol)        |
| `PRODUCT_MAP`         | Bound KV namespace for slug maps                |
| `HOOK_SECRET`         | Shared secret for `/__rebuild` + webhook HMAC   |

---

## Rebuild mechanics

1. **Triggered by**
   * `/__rebuild` (GET)
   * Valid Webflow webhook (POST, HMAC-SHA256 verified)
   * Scheduled Worker (default cron in `wrangler.jsonc`)
2. Fetch all items from overview, family, detail collections (100 × N).
3. Build two lookup tables:
   * `family[slug]  → {pretty, real}`
   * `detail[slug]  → {pretty, real}`
4. Persist to KV (`PRODUCT_MAP`, TTL = `CACHE_TTL`).

Memoised in-memory copy (`memo`) avoids KV hits for `MEMO_TTL`.

---

## Caching

* **Edge** – public, `s-maxage=86400`, SWR 1 year.
* **In-memory** – `memo` for 5 min to cut KV reads.
* Cache key = full request URL (incl. query).
* Failed or non-`GET` responses are **not** cached.

---

## Security

* Constant-time `safeEq` comparisons.
* Webhook signature: `HMAC-SHA256(secret, ts:body)` with 5-min age gate.

---

## Local development

```bash
# Set secrets
wrangler secret put WEBFLOW_API_TOKEN
wrangler secret put HOOK_SECRET

# Bind KV
wrangler kv namespace create PRODUCT_MAP
wrangler kv namespace create PRODUCT_MAP --preview

# Run
wrangler dev --remote
```
`Tip: hit http://localhost:8787/__rebuild after first start to prime maps.`

## Deployment

```bash
wrangler deploy
```

Cron schedule & bindings are defined in wrangler.toml.

## Troubleshooting

| Symptom                     | Likely cause / fix                                    |
| --------------------------- | ----------------------------------------------------- |
| `Error 1101` (worker crash) | Upstream fetch fails → check `WEBFLOW_ORIGIN` URI.    |
| 404 on known product        | KV flush / new deploy → call `/__rebuild`.            |
| Stale data                  | Wait 5 min (memo) or 24 h (edge) **or** `/__rebuild`. |
