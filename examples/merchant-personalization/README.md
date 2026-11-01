# Merchant personalization

A store page that ranks its own products for a shopper who connects their Hallie profile. Before they connect, it shows the catalog in the store's order. After they connect, every product is ranked for them, with a match score and the reasons. A product with something they avoid is marked and moved down.

```
1. The shopper clicks "Connect with Hallie" and approves on Halite's consent screen
2. The store swaps the returned code for tokens (OAuth 2.0 with PKCE)
3. The store sends its catalog to Halite's rank endpoint
4. Halite returns each product scored for this shopper, with reasons and warnings
```

## Run it

1. At [developers.haliteintelligence.com](https://developers.haliteintelligence.com), create an app and a **test** secret key.
2. On the app's **OAuth** tab, add `http://localhost:3000/callback` as a test redirect URI.
3. Run:

```sh
npm install
HALITE_SECRET_KEY=hk_test_… HALITE_CLIENT_ID=app_test_… npm start
```

Open [http://localhost:3000](http://localhost:3000) and click **Connect with Hallie**. In test mode the consent screen offers sample shoppers instead of asking for an email. Pick one, untick anything you like, and approve.

### Webhooks (optional)

Add a test webhook endpoint pointing at `/webhooks/halite` (from a tunnel such as `ngrok http 3000`), and set `HALITE_WEBHOOK_SECRET` to its signing secret. When a shopper disconnects anywhere, Halite sends `consent.revoked` and the store forgets them.

## What to look at

- [`src/server.ts`](src/server.ts): the whole store in one file.
- `halite.oauth.authorizeUrl()` makes the PKCE pair and `state` for you. Keep both server-side and check `state` on the way back.
- The scopes the shopper actually approved come back in `tokens.scope`. They can untick things, so check it.
- `halite.consumer(tokens, { onTokens })` refreshes expired access tokens. Store the new pair: a refresh token works once.
- Sessions live in memory to keep the example short. In a real store, keep tokens in your database, encrypted.
