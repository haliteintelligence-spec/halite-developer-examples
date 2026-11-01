import { createHmac, timingSafeEqual } from 'node:crypto'
import { WebhookSignatureError } from './errors.js'
import type { HaliteEvent } from './types.js'

/**
 * Checks a webhook request and returns its event.
 *
 * Pass the raw request body exactly as received — parsing and re-serialising
 * JSON changes the bytes and the signature will not match. Requests older
 * than `toleranceSeconds` (default 5 minutes) are refused as replays.
 *
 *   const event = verifyWebhook({ payload: rawBody, signature: req.headers['halite-signature'], secret })
 */
export function verifyWebhook(opts: {
  payload: string | Buffer
  signature: string | string[] | undefined | null
  secret: string
  toleranceSeconds?: number
  /** Unix seconds; for tests. */
  now?: number
}): HaliteEvent {
  const header = Array.isArray(opts.signature) ? opts.signature[0] : opts.signature
  if (!header) throw new WebhookSignatureError('Missing Halite-Signature header')
  const body = typeof opts.payload === 'string' ? opts.payload : opts.payload.toString('utf-8')

  const parts = header.split(',').map(p => p.trim())
  const t = Number(parts.find(p => p.startsWith('t='))?.slice(2))
  if (!Number.isFinite(t)) throw new WebhookSignatureError('Malformed Halite-Signature header')
  const now = opts.now ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - t) > (opts.toleranceSeconds ?? 300)) throw new WebhookSignatureError('Signature timestamp is outside the tolerance')

  const expected = Buffer.from(createHmac('sha256', opts.secret).update(`${t}.${body}`).digest('hex'))
  const ok = parts
    .filter(p => p.startsWith('v1='))
    .some(p => {
      const given = Buffer.from(p.slice(3))
      return given.length === expected.length && timingSafeEqual(given, expected)
    })
  if (!ok) throw new WebhookSignatureError('Signature does not match')
  return JSON.parse(body) as HaliteEvent
}
