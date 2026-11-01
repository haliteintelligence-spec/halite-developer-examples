import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Halite, HaliteError, WebhookSignatureError, createPkce, verifyWebhook } from '../src/index.js'

describe('verifyWebhook', () => {
  const secret = 'whsec_test'
  const body = JSON.stringify({ id: 'evt_1', type: 'consent.granted', created: 1, environment: 'test', data: { consumer_id: 'hlp_test_x' } })
  const t = 1_800_000_000
  const sig = (s: string, ts = t, b = body) => `t=${ts},v1=${createHmac('sha256', s).update(`${ts}.${b}`).digest('hex')}`

  it('returns the event for a good signature, from a string or a Buffer', () => {
    expect(verifyWebhook({ payload: body, signature: sig(secret), secret, now: t }).type).toBe('consent.granted')
    expect(verifyWebhook({ payload: Buffer.from(body), signature: sig(secret), secret, now: t }).id).toBe('evt_1')
  })

  it('accepts either signature during a secret rotation', () => {
    const header = `${sig('whsec_new')},v1=${sig(secret).split('v1=')[1]}`
    expect(() => verifyWebhook({ payload: body, signature: header, secret, now: t })).not.toThrow()
  })

  it('refuses tampering, wrong secrets, replays and missing headers', () => {
    expect(() => verifyWebhook({ payload: body + ' ', signature: sig(secret), secret, now: t })).toThrow(WebhookSignatureError)
    expect(() => verifyWebhook({ payload: body, signature: sig('whsec_other'), secret, now: t })).toThrow(WebhookSignatureError)
    expect(() => verifyWebhook({ payload: body, signature: sig(secret), secret, now: t + 301 })).toThrow(/tolerance/)
    expect(() => verifyWebhook({ payload: body, signature: undefined, secret })).toThrow(/Missing/)
  })
})

describe('OAuth helpers', () => {
  it('makes an S256 PKCE pair', () => {
    const { codeVerifier, codeChallenge } = createPkce()
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43)
    expect(codeChallenge).toBe(createHash('sha256').update(codeVerifier).digest('base64url'))
  })

  it('builds the authorize URL with PKCE and state', () => {
    const halite = new Halite({ secretKey: 'hk_test_x', clientId: 'app_test_abc', baseUrl: 'https://api.example.com/' })
    const { url, state, codeVerifier } = halite.oauth.authorizeUrl({ redirectUri: 'https://app.example.com/cb', scopes: ['preferences.read', 'offline_access'], categories: ['beauty.hair'] })
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe('https://api.example.com/oauth/authorize')
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      response_type: 'code', client_id: 'app_test_abc', redirect_uri: 'https://app.example.com/cb',
      scope: 'preferences.read offline_access', categories: 'beauty.hair', state, code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(codeVerifier).digest('base64url'),
    })
  })
})

describe('errors', () => {
  it('surfaces the API error code, request id and Retry-After', async () => {
    const fake = (async () => new Response(JSON.stringify({ error: { type: 'rate_limit_error', code: 'rate_limited', message: 'slow down', request_id: 'req-9', doc_url: 'https://x/docs' } }), { status: 429, headers: { 'retry-after': '30' } })) as unknown as typeof fetch
    const halite = new Halite({ secretKey: 'hk_test_x', fetch: fake })
    const err = await halite.app().catch(e => e)
    expect(err).toBeInstanceOf(HaliteError)
    expect(err).toMatchObject({ status: 429, code: 'rate_limited', requestId: 'req-9', retryAfter: 30 })
  })
})
