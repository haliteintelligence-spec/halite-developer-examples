# Authentication

Halite has two kinds of credential:

| | Looks like | Identifies | Where it lives |
|---|---|---|---|
| **Secret key** | `hk_test_…`, `hk_live_…` | Your app | Your server only |
| **Access token** | `hla_…` | One shopper, for your app | Your server, per shopper |

Your secret key calls the app endpoints (`/v1/app`, `/v1/grants`, the sandbox) and signs your token requests. A shopper's access token calls the consumer endpoints (`/v1/consumer/…`, `/v1/intelligence/…`) and only ever sees what that shopper shared with you.

## Keys

Create keys on your app's **API keys** tab at [developers.haliteintelligence.com](https://developers.haliteintelligence.com). A key is shown once; Halite keeps only its hash.

- **Test keys** (`hk_test_…`) reach six sample shoppers and nobody else. Use them to build.
- **Live keys** (`hk_live_…`) work once Halite approves your app for production.

```sh
curl https://api.haliteintelligence.com/v1/app \
  -H "Authorization: Bearer $HALITE_SECRET_KEY"
```

Never put a secret key in a browser, a mobile app or a public repository. Halite keys start with `hk_` so scanners can spot them: if one is pushed to a public GitHub repository, GitHub tells Halite, the key is revoked at once and your organization's owners are emailed. Rolling a key keeps the old one working for a grace period, and you're emailed before it stops.

## Signing a shopper in: OAuth 2.0 with PKCE

Halite uses the standard authorization code flow with PKCE, so off-the-shelf OAuth libraries work. The discovery document is at `https://api.haliteintelligence.com/.well-known/oauth-authorization-server`.

### Before you start

- On your app's **OAuth** tab, register your callback URL as a test redirect URI. It must match exactly. `http://localhost` works in test.
- Fill in your app's name, logo, homepage and privacy policy on **Overview**: the consent screen shows them.

### The flow

1. Make a PKCE pair and a random `state`. Keep both in the shopper's server-side session.
2. Redirect the shopper to `/oauth/authorize`.
3. They approve, untick some scopes, or cancel on Halite's consent screen.
4. They come back to your redirect URI with `code`, `state` and `iss`. Check that `state` matches.
5. Within 60 seconds, exchange the code at `/oauth/token` with your client ID and secret key.

```
https://api.haliteintelligence.com/oauth/authorize
  ?response_type=code
  &client_id=app_test_…
  &redirect_uri=https%3A%2F%2Fyour.app%2Fcallback
  &scope=profile.read%20preferences.read%20offline_access
  &categories=beauty.skincare%20beauty.hair      (optional; all when omitted)
  &state=…
  &code_challenge=…                             (base64url SHA-256 of the verifier)
  &code_challenge_method=S256
```

If the client ID or redirect URI is wrong, Halite shows an error and never redirects. Any other problem comes back to your redirect URI as `?error=…&error_description=…&state=…`. A shopper who cancels comes back with `error=access_denied`.

```sh
curl https://api.haliteintelligence.com/oauth/token \
  -u "$HALITE_CLIENT_ID:$HALITE_SECRET_KEY" \
  -d grant_type=authorization_code \
  -d code=hlc_… \
  -d redirect_uri=https://your.app/callback \
  -d code_verifier=…
```

```json
{
  "access_token": "hla_…",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "hlr_…",
  "scope": "profile.read preferences.read offline_access",
  "consumer_id": "hlp_test_…"
}
```

- `scope` is what the shopper actually approved. Check it: they can untick things.
- `consumer_id` is stable for your app. The same shopper signing in again gets the same ID, and no other app sees that ID for them.

With the SDK, `halite.oauth.authorizeUrl()` makes the PKCE pair and `state`, and `halite.oauth.exchangeCode()` swaps the code. See [`examples/merchant-personalization`](../examples/merchant-personalization/src/server.ts) for a working server.

### In test mode

The consent screen offers the sample shoppers instead of asking for an email, so you can run the whole flow without a real account. For tests that skip the screen entirely, `POST /v1/sandbox/grants` returns the same tokens for a sample shopper:

```sh
curl https://api.haliteintelligence.com/v1/sandbox/grants \
  -H "Authorization: Bearer $HALITE_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"persona": "coily_routine", "scopes": ["profile.read", "preferences.read", "context.read"]}'
```

### With real shoppers

With your live client ID, the consent screen asks the shopper for the email on their Hallie account and sends them a code. Only people with a Hallie account can connect. Approving your app also turns on partner sharing in their Hallie account, and the screen tells them so.

## Staying connected

- Access tokens last an hour.
- Ask for `offline_access` to also get a refresh token, which lasts 90 days.
- Refresh tokens **rotate**: each works once, and the response carries a new one, which you must store. If an old refresh token is used again, Halite assumes it leaked and revokes every token from that sign-in.

```sh
curl https://api.haliteintelligence.com/oauth/token \
  -u "$HALITE_CLIENT_ID:$HALITE_SECRET_KEY" \
  -d grant_type=refresh_token -d refresh_token=hlr_…
```

The SDK refreshes for you when an access token expires: `halite.consumer(tokens, { onTokens: save })`.

## Errors

| Code | Status | Meaning |
|---|---|---|
| `missing_api_key` | 401 | No `Authorization` header. Send your secret key as a Bearer token. |
| `invalid_api_key` | 401 | Unknown, revoked or expired key, or a key for the other environment. |
| `access_token_required` | 401 | A consumer endpoint was called with a secret key. Use the shopper's access token. |
| `token_expired` | 401 | The access token is over an hour old. Refresh it. |
| `token_revoked` | 401 | The token was revoked, by your app or because its refresh token was reused. |
| `consent_revoked` | 401 | The shopper disconnected your app, or switched off partner sharing. Stop calling for them and delete what you stored. |
| `production_not_approved` | 403 | A live key was used before the app was approved for production. |
| `rate_limited` | 429 | Too many requests this minute. Wait `Retry-After` seconds. |

Every error has the same shape, with a `request_id` to quote if you contact support. The full list is in the [OpenAPI document](../openapi/openapi.json) and at [developers.haliteintelligence.com/docs/errors](https://developers.haliteintelligence.com/docs/errors).
