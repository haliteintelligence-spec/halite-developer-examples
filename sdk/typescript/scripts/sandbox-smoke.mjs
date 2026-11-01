// Checks a Halite deployment end to end through the SDK, with a test key:
// key → personas → headless sign-in → data and scopes → refresh → events →
// disconnect. Touches only sandbox personas.
//
//   HALITE_SECRET_KEY=hk_test_… HALITE_CLIENT_ID=app_test_… npm run smoke
//   HALITE_API_URL=http://localhost:3001 … (defaults to production)
import { Halite, HaliteError, HaliteOAuthError } from '../dist/index.js'

const secretKey = process.env.HALITE_SECRET_KEY
const clientId = process.env.HALITE_CLIENT_ID
if (!secretKey?.startsWith('hk_test_')) {
  console.error('Set HALITE_SECRET_KEY to a test key (hk_test_…). The smoke test never runs with a live key.')
  process.exit(2)
}
const halite = new Halite({ secretKey, clientId, baseUrl: process.env.HALITE_API_URL })
let failures = 0
async function step(name, fn) {
  try {
    const note = await fn()
    console.log(`  ✓ ${name}${note ? ` — ${note}` : ''}`)
  } catch (err) {
    failures++
    console.log(`  ✗ ${name} — ${err instanceof Error ? err.message : err}`)
  }
}
const expectCode = async (promise, code) => {
  const err = await promise.then(() => null, e => e)
  if (!(err instanceof HaliteError) || err.code !== code) throw new Error(`expected ${code}, got ${err?.code ?? 'success'}`)
}

console.log(`Halite sandbox smoke test against ${halite.baseUrl}`)
let tokens, shopper, cursor
await step('key identifies a test app', async () => {
  const app = await halite.app()
  if (app.environment !== 'test') throw new Error(`environment is ${app.environment}`)
  return app.name
})
await step('six personas', async () => {
  const p = await halite.sandbox.personas()
  if (p.length !== 6) throw new Error(`${p.length} personas`)
})
await step('event feed position', async () => {
  for await (const e of halite.events.all()) cursor = e.id
})
await step('headless sign-in', async () => {
  tokens = await halite.sandbox.grant({ persona: 'coily_routine', scopes: ['profile.read', 'preferences.read', 'offline_access'], categories: ['beauty.hair'] })
  shopper = halite.consumer(tokens, { onTokens: (t) => { tokens = t } })
  return tokens.consumer_id
})
await step('reads granted data, cut to the category', async () => {
  const prefs = await shopper.preferences()
  if (prefs.hair?.type !== '4c' || prefs.skin !== null) throw new Error('unexpected preferences')
})
await step('refuses an ungranted scope', () => expectCode(shopper.purchases(), 'insufficient_scope'))
await step('refuses a secret key on consumer data', () => expectCode(halite.consumer(secretKey).profile(), 'access_token_required'))
await step('refresh rotates, and reusing the old token is refused', async () => {
  const old = tokens.refresh_token
  tokens = await halite.oauth.refresh(old)
  const reuse = await halite.oauth.refresh(old).then(() => null, e => e)
  if (!(reuse instanceof HaliteOAuthError) || reuse.error !== 'invalid_grant') throw new Error('the spent refresh token still worked')
})
await step('consent.granted in the feed', async () => {
  const types = []
  for await (const e of halite.events.all(cursor ? { after: cursor } : {})) types.push(e.type)
  if (!types.includes('consent.granted')) throw new Error(`feed has ${types.join(', ') || 'nothing'}`)
})
await step('simulated failure', () => expectCode(new Halite({ secretKey, baseUrl: halite.baseUrl, simulate: 'rate_limit' }).app(), 'rate_limited'))
await step('disconnect ends access', async () => {
  const fresh = await halite.sandbox.grant({ persona: 'new_shopper', scopes: ['preferences.read'] })
  const s = halite.consumer(fresh)
  await s.disconnect()
  await expectCode(s.preferences(), 'consent_revoked')
})
console.log(failures ? `\n${failures} step(s) failed` : '\nAll steps passed')
process.exit(failures ? 1 : 0)
