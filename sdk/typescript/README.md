# @halite/sdk

Server-side client for the [Halite Developer API](https://developers.haliteintelligence.com/docs): sign shoppers in with OAuth, read what they choose to share, follow consent changes, and verify webhooks. Node 18+, no dependencies.

```ts
import { Halite } from '@halite/sdk'

const halite = new Halite({
  secretKey: process.env.HALITE_SECRET_KEY!, // hk_test_… — server-side only
  clientId: process.env.HALITE_CLIENT_ID!,   // app_test_…
})

// 1. Send the shopper to Halite's consent screen.
const { url, state, codeVerifier } = halite.oauth.authorizeUrl({
  redirectUri: 'https://your.app/callback',
  scopes: ['profile.read', 'preferences.read', 'offline_access'],
})
// Store state + codeVerifier in the session, then redirect to `url`.

// 2. On the callback, check `state`, then swap the code for tokens.
const tokens = await halite.oauth.exchangeCode({ code, redirectUri: 'https://your.app/callback', codeVerifier })

// 3. Read what they shared. Expired access tokens are refreshed for you;
//    store the new pair — a refresh token works once.
const shopper = halite.consumer(tokens, { onTokens: (t) => saveTokens(tokens.consumer_id, t) })
const prefs = await shopper.preferences()
```

## Webhooks

```ts
import { verifyWebhook, WebhookSignatureError } from '@halite/sdk'

app.post('/webhooks/halite', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = verifyWebhook({ payload: req.body, signature: req.headers['halite-signature'], secret: process.env.HALITE_WEBHOOK_SECRET! })
    if (event.type === 'consent.revoked') forgetShopper(event.data.consumer_id)
    res.sendStatus(200)
  } catch (err) {
    res.sendStatus(err instanceof WebhookSignatureError ? 400 : 500)
  }
})
```

Pass the **raw** body: re-serialised JSON will not match the signature.

## Sandbox

Test keys only ever reach six sample shoppers.

```ts
const personas = await halite.sandbox.personas()
const tokens = await halite.sandbox.grant({ persona: 'coily_routine', scopes: ['preferences.read'] }) // no consent screen
await halite.sandbox.triggerEvent({ type: 'consent.revoked', consumerId: tokens.consumer_id })
new Halite({ secretKey, simulate: 'rate_limit' }) // rehearse failures
```

## Errors

API failures throw `HaliteError` with a stable `code` (`insufficient_scope`, `consent_revoked`, `rate_limited`, …), `status`, `requestId` and `retryAfter`. OAuth endpoint failures throw `HaliteOAuthError` with RFC 6749's `error`.
