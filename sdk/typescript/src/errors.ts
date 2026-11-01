/** An error from the API, with the stable `code` to branch on. */
export class HaliteError extends Error {
  readonly name = 'HaliteError'
  constructor(
    readonly status: number,
    readonly type: string,
    readonly code: string,
    message: string,
    readonly requestId: string | null = null,
    readonly docUrl: string | null = null,
    /** Seconds to wait, on a 429. */
    readonly retryAfter: number | null = null,
  ) {
    super(message)
  }
}

/** An error from the OAuth endpoints (RFC 6749's shape). */
export class HaliteOAuthError extends Error {
  readonly name = 'HaliteOAuthError'
  constructor(readonly status: number, readonly error: string, description: string) {
    super(description || error)
  }
}

/** A webhook whose signature does not check out. Answer it with a 400. */
export class WebhookSignatureError extends Error {
  readonly name = 'WebhookSignatureError'
}
