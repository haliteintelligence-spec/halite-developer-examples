# Consent

The shopper decides what your app sees. On Halite's consent screen they see what you're asking for and can untick any of it. You get exactly what they approved, in the categories they approved, until they take it back.

## Scopes: what kind of data

| Scope | Endpoint | What it gives you |
|---|---|---|
| `profile.read` | `GET /v1/consumer` | Name and verified email address. |
| `preferences.read` | `GET /v1/consumer/preferences` | Skin, body, hair, makeup and fragrance preferences, each with their main concern and the rest; ingredients to handle with care and why (allergy, avoids, reacts); tensions between what they said; how sensitive they are; how confident the profile is. |
| `interests.read` | `GET /v1/consumer/interests` | Categories they shop, what they spend per product in each, occasions, who they shop for. |
| `purchases.read` | `GET /v1/consumer/purchases` | Products they own, with their own rating, whether they'd buy again, and how it worked. |
| `purchases.retailers.read` | adds the retailer to purchases | Where they bought each product. Opt-in: never pre-ticked. |
| `context.read` | `GET /v1/consumer/context` | What kinds of product work for them, routines, seasonal direction, how fast they go through things. Never product or brand names. |
| `context.write` | `POST /v1/consumer/events` | What they view, save, buy, return and rate in your app, sent to Halite to keep their profile current. Always on once you ask for it, and they can see everything you send. |
| `offline_access` | refresh tokens | Access beyond the first hour, until they disconnect. |

Calling an endpoint without its scope answers `403 insufficient_scope`. `GET /v1/consumer/consent` works with any token and tells you what was granted.

## Categories: which part of their life

Scopes say what kind of data; categories say which part of their life. Pass `categories` to `/oauth/authorize` to ask only for what your app is about. A haircare app asking for `beauty.hair` is an easier yes than one asking for everything. Data outside the granted categories is left out of every response.

| Key | | Key | |
|---|---|---|---|
| `beauty.skincare` | Skincare | `beauty.nails` | Nails |
| `beauty.body` | Body care | `beauty.wellness` | Wellness |
| `beauty.hair` | Hair | `beauty.sun_care` | Sun care |
| `beauty.makeup` | Makeup | `beauty.lip_care` | Lip care |
| `beauty.fragrance` | Fragrance | `beauty.eye_care` | Eye care |

## What you never get

- **Names of products or brands they bought elsewhere.** Context describes what kinds of product worked for them ("ceramide moisturisers"), never which product or which brand.
- **Other apps.** You can't see which other apps or stores they've connected.

## Checking what was granted

```sh
curl https://api.haliteintelligence.com/v1/consumer/consent \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

```json
{
  "consumer_id": "hlp_test_…",
  "environment": "test",
  "status": "active",
  "scopes": ["profile.read", "preferences.read", "offline_access"],
  "token_scopes": ["profile.read", "preferences.read", "offline_access"],
  "categories": ["beauty.skincare", "beauty.hair"],
  "granted_at": "2026-11-01T12:00:00Z"
}
```

## Disconnecting

| Who | How | What happens |
|---|---|---|
| The shopper | In Hallie, or on the store's site | Your next call answers `consent_revoked`, and you get a `consent.revoked` webhook |
| Your app | `DELETE /v1/consumer/consent` | Every token for them stops working |
| Your app, one token | `POST /oauth/revoke` | That token stops working (for a refresh token, its whole sign-in) |

If a shopper switches off partner sharing in Hallie, every app loses access on its next call with `consent_revoked`, and gets it back if they switch it on again.

**When a shopper disconnects, delete what you stored about them from Halite.** They took that permission back.

## Webhooks

Add an https endpoint on your app's **Webhooks** tab and copy its signing secret (`whsec_…`, shown once).

| Event | When |
|---|---|
| `consent.granted` | A shopper connected your app, or reconnected after disconnecting. |
| `consent.updated` | A connected shopper signed in again and changed what you may see. |
| `consent.revoked` | A shopper disconnected your app, or your app disconnected itself. |
| `consent.expired` | A time-limited grant ran out. |
| `consumer.context.updated` | Something you can see about a shopper changed. Live only; names the views that changed (`profile`, `preferences`, `interests`, `purchases`, `context`). |

```json
{
  "id": "evt_…",
  "type": "consent.revoked",
  "created": 1793394570,
  "environment": "test",
  "data": {
    "consumer_id": "hlp_test_…",
    "scopes": ["profile.read", "preferences.read"],
    "categories": ["beauty.hair"],
    "revoked_by": "app"
  }
}
```

- Answer with any `2xx` within 10 seconds, and do slow work after you answer.
- An event can arrive more than once and out of order. Use `id` to skip duplicates and `created` to order them.

### Verifying the signature

Every request carries `Halite-Signature: t=1793394570,v1=5257a8…`. `v1` is the hex HMAC-SHA256 of `"{t}.{raw body}"` with your endpoint secret. Compute it, compare in constant time, and refuse anything where `t` is more than five minutes old. During a secret rotation the header carries two `v1` values for 24 hours; accept a match on either.

```ts
import { verifyWebhook, WebhookSignatureError } from '@halite/sdk'

app.post('/webhooks/halite', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = verifyWebhook({ payload: req.body, signature: req.header('halite-signature'), secret: process.env.HALITE_WEBHOOK_SECRET! })
    if (event.type === 'consent.revoked') forgetShopper(event.data.consumer_id)
    res.sendStatus(200)
  } catch (err) {
    res.sendStatus(err instanceof WebhookSignatureError ? 400 : 500)
  }
})
```

Pass the **raw** body: re-serialised JSON won't match the signature.

```python
import hashlib, hmac, time

def verify(raw_body: bytes, header: str, secret: str, tolerance: int = 300) -> bool:
    parts = [p.split("=", 1) for p in header.split(",")]
    t = int(next(v for k, v in parts if k == "t"))
    if abs(time.time() - t) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return any(k == "v1" and hmac.compare_digest(v, expected) for k, v in parts)
```

## In production

When Halite approves your app for production, it sets the most your live app may ask for. Live sign-ins can request those scopes and categories, never more.
