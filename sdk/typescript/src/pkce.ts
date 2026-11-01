import { createHash, randomBytes } from 'node:crypto'

/** A fresh PKCE pair (RFC 7636, S256). Keep the verifier server-side until the callback. */
export function createPkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(48).toString('base64url')
  return { codeVerifier, codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url') }
}

export function randomState(): string {
  return randomBytes(24).toString('base64url')
}
