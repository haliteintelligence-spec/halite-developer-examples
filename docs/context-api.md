# Context API

Once a shopper has connected, call these with their access token (`Authorization: Bearer hla_…`). Each returns only what they granted: the scopes they ticked and the categories they chose. The full request and response shapes are in [`openapi/openapi.json`](../openapi/openapi.json).

## What they shared

| Endpoint | Scope | Returns |
|---|---|---|
| `GET /v1/consumer` | `profile.read` | Name and verified email. |
| `GET /v1/consumer/preferences` | `preferences.read` | Per category: skin or hair type, main concern and the rest, ingredients to handle with care and why, tensions, sensitivity, confidence. |
| `GET /v1/consumer/interests` | `interests.read` | Categories they shop, budget per product in each, occasions, who they shop for. |
| `GET /v1/consumer/purchases` | `purchases.read` | Products they own, with their rating and how it worked. Products bought elsewhere are described, never named. |
| `GET /v1/consumer/context` | `context.read` | What works for them, routines, seasonal direction, replenishment rhythm. |
| `GET /v1/consumer/consent` | any | What they granted you. |

```sh
curl https://api.haliteintelligence.com/v1/consumer/context \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

```json
{
  "consumer_id": "hlp_test_…",
  "outcomes": { "positive": ["ceramides", "colloidal oatmeal", "fragrance-free"], "negative": ["fragrance", "essential oils"] },
  "routines": [
    {
      "name": "Morning", "category": "beauty.skincare", "time_of_day": "am", "days_used_last_30": 26,
      "steps": [
        { "order": 1, "product_type": "cleanser", "attributes": ["cream", "fragrance-free"] },
        { "order": 2, "product_type": "moisturiser", "attributes": ["ceramides"] },
        { "order": 3, "product_type": "sunscreen", "attributes": ["mineral"] }
      ]
    }
  ],
  "seasonal": { "season": "winter", "direction": "richer textures", "favour": ["balms", "occlusives"] },
  "replenishment": [{ "category": "beauty.skincare", "product_type": "moisturiser", "typical_days": 55 }]
}
```

`GET /v1/consumer/context` sends an `ETag`. Send it back as `If-None-Match`, and a `304` (nothing changed) isn't counted against your plan.

## Context Intelligence: answers, not just data

These use the same grant, and work out an answer for you.

| Endpoint | What it does |
|---|---|
| `GET /v1/intelligence/summary` | The shopper in plain words, plus the same facts as lists: what they're solving for, what to prefer, what never to recommend, budgets. Written for an AI agent's prompt. |
| `POST /v1/intelligence/rank` | Send up to 100 of your products; get them back best first, each with a match score (0–100), reasons, warnings, and `avoid` when it holds something they must not have. |
| `POST /v1/intelligence/compatibility` | One product: a verdict and why. |
| `POST /v1/intelligence/recommendations` | Varied best picks from your catalog, one per product type, skipping what they must avoid. |
| `POST /v1/intelligence/replenishment` | What they're due to run out of, and when. |
| `POST /v1/intelligence/intent` | A shopper's search turned into filters that fit them. |
| `GET /v1/intelligence/enrich` | Their profile filled out from what similar shoppers' outcomes suggest. |

All require `preferences.read`; they get better with `interests.read` (budgets) and `context.read` (what has worked).

```sh
curl https://api.haliteintelligence.com/v1/intelligence/rank \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "products": [
      { "id": "sku-101", "name": "Ceramide Barrier Cream", "price": 28, "currency": "USD", "category": "beauty.skincare",
        "product_type": "moisturizer", "ingredients": ["water", "ceramide np", "squalane"], "concerns": ["dryness"] },
      { "id": "sku-102", "name": "Rose Glow Face Oil", "price": 42, "currency": "USD", "category": "beauty.skincare",
        "product_type": "face oil", "ingredients": ["rosehip oil", "parfum", "linalool"], "concerns": ["dullness"] }
    ]
  }'
```

```json
{
  "consumer_id": "hlp_test_…",
  "confidence": 0.86,
  "items": [
    { "id": "sku-101", "rank": 1, "match": 100, "missing_quiz": null, "avoid": false,
      "reasons": ["Built on ceramides and squalane, which you gravitate to", "Targets dryness, which you said you're working on"], "warnings": [] },
    { "id": "sku-102", "rank": 2, "match": 41, "missing_quiz": null, "avoid": true,
      "reasons": [], "warnings": ["Contains fragrance, which you avoid"] }
  ]
}
```

When `match` is `null`, `missing_quiz` names a category the shopper hasn't answered (say, `beauty.hair`). Ask them, don't guess.

## Sending context back

With `context.write`, send what the shopper did in your app to `POST /v1/consumer/events`: up to 100 events at a time.

- **`id`:** your own. Resending it does nothing, so retries are safe.
- **`type`:** `product_viewed`, `product_saved`, `added_to_cart`, `purchased`, `returned`, `rated` or `searched`.
- **When it happened,** and **a category they shared with you.**
- **The product's `attributes` and `ingredients`:** that's what enriches their profile.

```ts
await shopper.sendEvents([{
  id: 'order-8812-line-1',
  type: 'purchased',
  occurred_at: new Date().toISOString(),
  category: 'beauty.skincare',
  product: { id: 'sku-101', name: 'Ceramide Barrier Cream', product_type: 'moisturizer', ingredients: ['ceramide np', 'squalane'] },
}])
```

Events enrich the profile every app and store reads: what kinds of product worked or failed, which categories they shop, how fast they go through things. Only your app sees its events as named products. Everyone else gets what the products were made of and how they went, never which product, which brand, or that your app sent it. Searches are kept but never used, because a query can name a brand. The shopper can see everything you sent. Sending context is never billed.

## Plans

Test keys reach every endpoint, with 500 intelligence units a month. Live:

- `/v1/consumer/context` needs the **Consumer Context** plan or higher. Each successful call counts as a context retrieval.
- `/v1/intelligence/*` needs the **Context Intelligence** plan or higher, and is counted in intelligence units (`rank` costs 1, `summary` costs 5).

A call above your plan answers `402 plan_required`, and the `Halite-Required-Tier` header names the plan it needs. See [developers.haliteintelligence.com/docs/plans](https://developers.haliteintelligence.com/docs/plans).
