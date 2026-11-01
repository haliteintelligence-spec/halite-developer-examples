/**
 * A store that personalizes for shoppers who connect Hallie.
 *
 *   GET  /            the catalog: in the store's order, or ranked for the connected shopper
 *   GET  /connect     sends the shopper to Halite's consent screen (OAuth + PKCE)
 *   GET  /callback    swaps the code for tokens
 *   POST /disconnect  ends the connection
 *   POST /webhooks/halite   consent.revoked: forget the shopper
 *
 * Sessions and tokens live in memory to keep the example short. Keep them
 * in your database, encrypted, in a real store.
 */
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import express, { type Request, type Response } from 'express'
import { Halite, HaliteError, WebhookSignatureError, verifyWebhook, type RankProduct, type Tokens } from '@haliteintelligence/sdk'

const secretKey = process.env.HALITE_SECRET_KEY
const clientId = process.env.HALITE_CLIENT_ID
if (!secretKey || !clientId) {
  console.error('Set HALITE_SECRET_KEY (hk_test_…) and HALITE_CLIENT_ID (app_test_…). See README.md.')
  process.exit(2)
}
const PORT = Number(process.env.PORT ?? 3000)
const REDIRECT_URI = process.env.REDIRECT_URI ?? `http://localhost:${PORT}/callback`

const halite = new Halite({ secretKey, clientId, ...(process.env.HALITE_API_URL ? { baseUrl: process.env.HALITE_API_URL } : {}) })
const catalog = JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url), 'utf8')) as RankProduct[]

// ── Sessions: a random id in a cookie, everything else on the server ──
interface Session { oauth?: { state: string; codeVerifier: string }; tokens?: Tokens; name?: string }
const sessions = new Map<string, Session>()

function session(req: Request, res: Response): Session {
  const sid = /(?:^|;\s*)sid=([A-Za-z0-9_-]+)/.exec(req.headers.cookie ?? '')?.[1]
  if (sid && sessions.has(sid)) return sessions.get(sid)!
  const fresh = randomBytes(24).toString('base64url')
  sessions.set(fresh, {})
  res.setHeader('Set-Cookie', `sid=${fresh}; HttpOnly; SameSite=Lax; Path=/`)
  return sessions.get(fresh)!
}

function forget(consumerId: string): void {
  for (const s of sessions.values()) if (s.tokens?.consumer_id === consumerId) { delete s.tokens; delete s.name }
}

const app = express()

// Webhooks need the raw body: re-serialised JSON won't match the signature.
app.post('/webhooks/halite', express.raw({ type: 'application/json' }), (req, res) => {
  const secret = process.env.HALITE_WEBHOOK_SECRET
  if (!secret) { res.sendStatus(404); return }
  try {
    const event = verifyWebhook({ payload: req.body, signature: req.header('halite-signature'), secret })
    if (event.type === 'consent.revoked') forget(String((event.data as { consumer_id: string }).consumer_id))
    res.sendStatus(200)
  } catch (err) {
    res.sendStatus(err instanceof WebhookSignatureError ? 400 : 500)
  }
})

app.get('/connect', (req, res) => {
  const s = session(req, res)
  const { url, state, codeVerifier } = halite.oauth.authorizeUrl({
    redirectUri: REDIRECT_URI,
    scopes: ['profile.read', 'preferences.read', 'interests.read', 'offline_access'],
  })
  s.oauth = { state, codeVerifier }
  res.redirect(url)
})

app.get('/callback', async (req, res) => {
  const s = session(req, res)
  const saved = s.oauth
  delete s.oauth
  if (!saved || req.query.state !== saved.state) { res.status(400).send('That sign-in link has expired. Try connecting again.'); return }
  if (req.query.error) { res.redirect('/'); return } // they cancelled
  try {
    s.tokens = await halite.oauth.exchangeCode({ code: String(req.query.code), redirectUri: REDIRECT_URI, codeVerifier: saved.codeVerifier })
    s.name = (await shopperFor(s).profile()).name ?? undefined
    res.redirect('/')
  } catch (err) {
    res.status(502).send(`Halite couldn't finish connecting: ${err instanceof Error ? err.message : err}`)
  }
})

app.post('/disconnect', async (req, res) => {
  const s = session(req, res)
  if (s.tokens) await shopperFor(s).disconnect().catch(() => {})
  delete s.tokens
  delete s.name
  res.redirect('/')
})

app.get('/', async (req, res) => {
  const s = session(req, res)
  let ranked: Awaited<ReturnType<ReturnType<typeof shopperFor>['rank']>> | null = null
  if (s.tokens) {
    try {
      ranked = await shopperFor(s).rank(catalog, { limit: catalog.length })
    } catch (err) {
      // They disconnected in Hallie, or switched sharing off: back to the plain store.
      if (err instanceof HaliteError && ['consent_revoked', 'invalid_token'].includes(err.code)) { delete s.tokens; delete s.name }
      else throw err
    }
  }
  res.type('html').send(page(ranked, s.name))
})

/** The shopper's client; refreshed tokens are written back to the session. */
function shopperFor(s: Session) {
  return halite.consumer(s.tokens!, { onTokens: (t) => { s.tokens = t } })
}

// ── The page ──────────────────────────────────────────────────────────
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

function page(ranked: { items: Array<{ id: string; match: number | null; reasons: string[]; warnings: string[]; avoid: boolean }> } | null, name?: string): string {
  const scores = new Map(ranked?.items.map(i => [i.id, i]) ?? [])
  const order = ranked ? ranked.items.map(i => catalog.find(p => p.id === i.id)!).filter(Boolean) : catalog
  const cards = order.map(p => {
    const r = scores.get(p.id)
    const badge = r?.match != null ? `<span class="match${r.avoid ? ' avoid' : ''}">${r.avoid ? 'Not for you' : `${Math.round(r.match)}% match`}</span>` : ''
    const why = r ? [...r.reasons.slice(0, 2).map(x => `<li>✓ ${esc(x)}</li>`), ...r.warnings.slice(0, 1).map(x => `<li class="warn">! ${esc(x)}</li>`)].join('') : ''
    return `<article class="card${r?.avoid ? ' faded' : ''}">${badge}<h3>${esc(p.name)}</h3><p class="price">$${esc(p.price)}</p>${why ? `<ul>${why}</ul>` : ''}</article>`
  }).join('')
  const bar = ranked
    ? `<div class="bar"><span><b>Hallie connected</b>${name ? ` · ${esc(name)}` : ''}</span><form method="post" action="/disconnect"><button>Disconnect</button></form></div>`
    : `<div class="bar"><span>Connect your Hallie profile and we'll rank everything for you.</span><a class="cta" href="/connect">Connect with Hallie</a></div>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Example Store</title><style>
body{margin:0;font:15px/1.5 system-ui,sans-serif;color:#1d1d1f;background:#fafaf8}
header{padding:18px 24px;border-bottom:1px solid #e6e4df;font-weight:700;letter-spacing:.08em}
.bar{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center;padding:12px 24px;background:#f1ece6}
.bar button{background:none;border:0;text-decoration:underline;cursor:pointer;color:#6b6b6b;font:inherit}
.cta{background:#1d1d1f;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none}
main{padding:24px;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
.card{position:relative;background:#fff;border:1px solid #e6e4df;border-radius:12px;padding:44px 16px 16px}
.card h3{margin:0 0 4px;font-size:16px}.price{margin:0;color:#6b6b6b}
.card ul{margin:10px 0 0;padding:0;list-style:none;font-size:13px;color:#3d3d3d}.warn{color:#9a3412}
.match{position:absolute;top:12px;left:12px;background:#1d1d1f;color:#fff;font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px}
.match.avoid{background:#9a3412}.faded{opacity:.55}
</style></head><body><header>EXAMPLE STORE</header>${bar}<main>${cards}</main></body></html>`
}

app.listen(PORT, () => console.log(`Example store on http://localhost:${PORT}`))
