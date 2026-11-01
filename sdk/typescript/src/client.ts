import { HaliteError, HaliteOAuthError } from './errors.js'
import { createPkce, randomState } from './pkce.js'
import type {
  AppInfo, CategoryKey, Compatibility, Consent, Enriched, Intent, Recommendations, Replenishment, Consumer, Context, ContextEvent, ContextEventPage, ContextEventsAccepted, EventPage, EventType, Grant, HaliteEvent,
  Interests, Persona, Preferences, Purchases, RankProduct, Ranked, Scope, Summary, Tokens,
} from './types.js'

export interface HaliteOptions {
  /** hk_test_… or hk_live_…. Server-side only; never ship it to a browser or app. */
  secretKey: string
  /** app_test_… or app_live_… — needed for OAuth. Must match the key's environment. */
  clientId?: string
  /** Defaults to https://api.haliteintelligence.com. */
  baseUrl?: string
  fetch?: typeof fetch
  /** Sent as Halite-Simulate on every call (test keys only), to rehearse failures. */
  simulate?: string
}

type Query = Record<string, string | number | undefined>

/**
 * The Halite Developer API.
 *
 *   const halite = new Halite({ secretKey: process.env.HALITE_SECRET_KEY!, clientId: process.env.HALITE_CLIENT_ID! })
 *   const { url, state, codeVerifier } = halite.oauth.authorizeUrl({ redirectUri, scopes: ['preferences.read'] })
 *   // …consumer approves, comes back with ?code=…
 *   const tokens = await halite.oauth.exchangeCode({ code, redirectUri, codeVerifier })
 *   const prefs = await halite.consumer(tokens).preferences()
 */
export class Halite {
  readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(private readonly opts: HaliteOptions) {
    if (!opts.secretKey) throw new Error('Halite: secretKey is required')
    this.baseUrl = (opts.baseUrl ?? 'https://api.haliteintelligence.com').replace(/\/$/, '')
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis)
  }

  get environment(): 'test' | 'live' {
    return this.opts.secretKey.startsWith('hk_live_') ? 'live' : 'test'
  }

  /** @internal */
  async request<T>(method: string, path: string, opts: { bearer: string; query?: Query; body?: unknown } ): Promise<T> {
    const url = new URL(this.baseUrl + path)
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v))
    const headers: Record<string, string> = { authorization: `Bearer ${opts.bearer}`, accept: 'application/json' }
    if (opts.body !== undefined) headers['content-type'] = 'application/json'
    if (this.opts.simulate) headers['halite-simulate'] = this.opts.simulate
    const res = await this.fetchImpl(url, { method, headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) })
    const json = await res.json().catch(() => ({})) as Record<string, unknown>
    if (!res.ok) {
      const e = (json.error ?? {}) as Record<string, string | undefined>
      const retry = res.headers.get('retry-after')
      throw new HaliteError(res.status, e.type ?? 'api_error', e.code ?? 'unknown_error', e.message ?? `HTTP ${res.status}`,
        e.request_id ?? null, e.doc_url ?? null, retry ? Number(retry) : null)
    }
    return json as T
  }

  private appCall<T>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}) {
    return this.request<T>(method, path, { bearer: this.opts.secretKey, ...opts })
  }

  /** Which app and environment the key belongs to. */
  app(): Promise<AppInfo> {
    return this.appCall('GET', '/v1/app')
  }

  /** Consumers connected to your app. */
  async grants(): Promise<Grant[]> {
    return (await this.appCall<{ grants: Grant[] }>('GET', '/v1/grants')).grants
  }

  readonly events = {
    /** One page of events, oldest first. */
    list: (params: { after?: string; type?: EventType; limit?: number } = {}): Promise<EventPage> =>
      this.appCall('GET', '/v1/events', { query: params }),
    /** Every event after `after`, paging as needed. Remember the last id you processed. */
    all: async function* (this: Halite, params: { after?: string; type?: EventType } = {}): AsyncGenerator<HaliteEvent> {
      let after = params.after
      for (;;) {
        const page: EventPage = await this.events.list({ ...params, ...(after ? { after } : {}), limit: 100 })
        for (const e of page.events) yield e
        if (!page.has_more || !page.next_after) return
        after = page.next_after
      }
    }.bind(this),
  }

  readonly oauth = {
    /**
     * Where to send the consumer. Store `state` and `codeVerifier` (in the
     * session, server-side) and check `state` when they come back.
     */
    authorizeUrl: (params: { redirectUri: string; scopes: Scope[]; categories?: CategoryKey[]; state?: string }) => {
      const clientId = this.requireClientId()
      const { codeVerifier, codeChallenge } = createPkce()
      const state = params.state ?? randomState()
      const url = new URL(`${this.baseUrl}/oauth/authorize`)
      url.search = new URLSearchParams({
        response_type: 'code', client_id: clientId, redirect_uri: params.redirectUri,
        scope: params.scopes.join(' '), state, code_challenge: codeChallenge, code_challenge_method: 'S256',
        ...(params.categories ? { categories: params.categories.join(' ') } : {}),
      }).toString()
      return { url: url.toString(), state, codeVerifier }
    },
    exchangeCode: (params: { code: string; redirectUri: string; codeVerifier: string }): Promise<Tokens> =>
      this.tokenCall('/oauth/token', { grant_type: 'authorization_code', code: params.code, redirect_uri: params.redirectUri, code_verifier: params.codeVerifier }),
    /** A refresh token works once: store the new pair this returns. */
    refresh: (refreshToken: string, scopes?: Scope[]): Promise<Tokens> =>
      this.tokenCall('/oauth/token', { grant_type: 'refresh_token', refresh_token: refreshToken, ...(scopes ? { scope: scopes.join(' ') } : {}) }),
    revoke: async (token: string): Promise<void> => {
      await this.tokenCall('/oauth/revoke', { token })
    },
  }

  private requireClientId(): string {
    if (!this.opts.clientId) throw new Error('Halite: clientId is required for OAuth')
    return this.opts.clientId
  }

  private async tokenCall<T>(path: string, form: Record<string, string>): Promise<T> {
    const basic = Buffer.from(`${encodeURIComponent(this.requireClientId())}:${encodeURIComponent(this.opts.secretKey)}`).toString('base64')
    const res = await this.fetchImpl(this.baseUrl + path, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
    })
    const json = await res.json().catch(() => ({})) as Record<string, string>
    if (!res.ok) throw new HaliteOAuthError(res.status, json.error ?? 'server_error', json.error_description ?? '')
    return json as T
  }

  /**
   * Calls on one consumer's behalf. Given tokens with a refresh token, an
   * expired access token is refreshed once automatically; `onTokens` gets
   * the new pair, which you must store — the old refresh token is spent.
   */
  consumer(tokens: string | Pick<Tokens, 'access_token' | 'refresh_token'>, opts: { onTokens?: (t: Tokens) => void | Promise<void> } = {}): ConsumerClient {
    const state = typeof tokens === 'string' ? { access_token: tokens } : { ...tokens }
    return new ConsumerClient(this, state, opts.onTokens)
  }

  readonly sandbox = {
    personas: async (): Promise<Persona[]> => (await this.appCall<{ personas: Persona[] }>('GET', '/v1/sandbox/personas')).personas,
    /** Signs a persona in without the consent screen — for automated tests. */
    grant: (params: { persona: string; scopes: Scope[]; categories?: CategoryKey[] }): Promise<Tokens & { persona: string }> =>
      this.appCall('POST', '/v1/sandbox/grants', { body: params }),
    revoke: (consumerId: string): Promise<{ consumer_id: string; status: 'revoked' }> =>
      this.appCall('POST', `/v1/sandbox/grants/${encodeURIComponent(consumerId)}/revoke`, { body: {} }),
    triggerEvent: (params: { type: EventType; consumerId?: string }): Promise<{ event_id: string; deliveries: number }> =>
      this.appCall('POST', '/v1/sandbox/webhooks/trigger', { body: { type: params.type, ...(params.consumerId ? { consumer_id: params.consumerId } : {}) } }),
  }
}

export class ConsumerClient {
  constructor(
    private readonly halite: Halite,
    private tokens: { access_token: string; refresh_token?: string | undefined },
    private readonly onTokens?: (t: Tokens) => void | Promise<void>,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    try {
      return await this.halite.request<T>(method, path, { bearer: this.tokens.access_token, ...(body === undefined ? {} : { body }) })
    } catch (err) {
      if (!(err instanceof HaliteError) || err.code !== 'token_expired' || !this.tokens.refresh_token) throw err
      const fresh = await this.halite.oauth.refresh(this.tokens.refresh_token)
      this.tokens = fresh
      await this.onTokens?.(fresh)
      return this.halite.request<T>(method, path, { bearer: fresh.access_token, ...(body === undefined ? {} : { body }) })
    }
  }

  /** profile.read */
  profile(): Promise<Consumer> { return this.call('GET', '/v1/consumer') }
  /** preferences.read */
  preferences(): Promise<Preferences> { return this.call('GET', '/v1/consumer/preferences') }
  /** interests.read */
  interests(): Promise<Interests> { return this.call('GET', '/v1/consumer/interests') }
  /** purchases.read (retailers with purchases.retailers.read) */
  purchases(): Promise<Purchases> { return this.call('GET', '/v1/consumer/purchases') }
  /** context.read */
  context(): Promise<Context> { return this.call('GET', '/v1/consumer/context') }
  /** context.write: what they did in your app, up to 100 at a time. Never billed. */
  sendEvents(events: ContextEvent[]): Promise<ContextEventsAccepted> { return this.call('POST', '/v1/consumer/events', { events }) }
  /** context.write: what your app has sent for this consumer, newest first. */
  sentEvents(opts: { limit?: number; before?: string } = {}): Promise<ContextEventPage> {
    const q = new URLSearchParams()
    if (opts.limit) q.set('limit', String(opts.limit))
    if (opts.before) q.set('before', opts.before)
    const qs = q.toString()
    return this.call('GET', `/v1/consumer/events${qs ? `?${qs}` : ''}`)
  }
  /** What the consumer granted; works with any valid token. */
  consent(): Promise<Consent> { return this.call('GET', '/v1/consumer/consent') }
  /** Context Intelligence: your products, best first for this consumer, with reasons. 1 unit. */
  rank(products: RankProduct[], opts: { limit?: number } = {}): Promise<Ranked> {
    return this.call('POST', '/v1/intelligence/rank', { products, ...(opts.limit ? { limit: opts.limit } : {}) })
  }
  /** Context Intelligence: the consumer in plain words for an agent, plus the facts as lists. 5 units. */
  summary(): Promise<Summary> { return this.call('GET', '/v1/intelligence/summary') }
  /** Context Intelligence: one product's fit, with a verdict. 1 unit. */
  compatibility(product: RankProduct): Promise<Compatibility> { return this.call('POST', '/v1/intelligence/compatibility', { product }) }
  /** Context Intelligence: every product scored and flagged, the best few marked. 2 units. */
  recommendations(products: RankProduct[], opts: { picks?: number; per_type?: number } = {}): Promise<Recommendations> {
    return this.call('POST', '/v1/intelligence/recommendations', { products, ...opts })
  }
  /** Context Intelligence: what they are running out of (context.read; dates with purchases.read). 2 units. */
  replenishment(opts: { within_days?: number; products?: RankProduct[] } = {}): Promise<Replenishment> {
    return this.call('POST', '/v1/intelligence/replenishment', opts)
  }
  /** Context Intelligence: what the shopper typed, as filters filled in from their profile. 5 units. */
  intent(query: string, opts: { category?: CategoryKey } = {}): Promise<Intent> {
    return this.call('POST', '/v1/intelligence/intent', { query, ...opts })
  }
  /** Context Intelligence: stated preferences plus what their own products show. 10 units. */
  enrich(): Promise<Enriched> { return this.call('GET', '/v1/intelligence/enrich') }
  /** Your app disconnects from this consumer. Every token for them stops working. */
  disconnect(): Promise<{ consumer_id: string; status: 'revoked' }> { return this.call('DELETE', '/v1/consumer/consent') }
}
