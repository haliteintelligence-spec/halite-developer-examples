/**
 * A shopping agent, end to end:
 *
 *   1. The shopper authorizes the agent.        (here: a sandbox shopper, no consent screen)
 *   2. The agent asks Halite for their context.
 *   3. Halite returns what they've chosen to share.
 *   4. The agent personalizes: it ranks a catalog for them and explains why.
 *
 * Run with a test key: HALITE_SECRET_KEY=hk_test_… npm start [persona]
 * In production, step 1 is the OAuth flow; see ../merchant-personalization.
 */
import { readFileSync } from 'node:fs'
import { Halite, HaliteError, type RankProduct, type Scope } from '@halite/sdk'

const secretKey = process.env.HALITE_SECRET_KEY
if (!secretKey?.startsWith('hk_test_')) {
  console.error('Set HALITE_SECRET_KEY to a test key (hk_test_…). Create one at https://developers.haliteintelligence.com')
  process.exit(2)
}

const halite = new Halite({ secretKey, ...(process.env.HALITE_API_URL ? { baseUrl: process.env.HALITE_API_URL } : {}) })
const catalog = JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url), 'utf8')) as RankProduct[]
const persona = process.argv[2] ?? 'dry_sensitive'

async function main() {
  // ── 1. The shopper authorizes the agent ─────────────────────────────
  // Sandbox only: sign a sample shopper in without the consent screen. The
  // tokens are the same shape the OAuth flow returns for a real shopper.
  const scopes: Scope[] = ['profile.read', 'preferences.read', 'interests.read', 'context.read']
  const tokens = await halite.sandbox.grant({ persona, scopes })
  const shopper = halite.consumer(tokens)
  const consent = await shopper.consent()
  console.log(`1. Authorized: ${consent.consumer_id} shared ${consent.scopes.join(', ')}\n`)

  // ── 2 + 3. The agent asks for context; Halite returns preferences ───
  // `summary` is written for an agent: plain words plus the same facts as
  // lists. Only what the shopper granted, in the categories they granted.
  const summary = await shopper.summary()
  console.log(`2. Halite says: ${summary.summary}`)
  const h = summary.highlights
  if (h.solving_for.length) console.log(`   Solving for: ${h.solving_for.join(', ')}`)
  if (h.never_recommend.length) console.log(`   Never recommend: ${h.never_recommend.join(', ')}`)
  for (const b of h.budgets) console.log(`   Budget: up to ${b.per_product_max} ${b.currency} per ${b.category} product`)

  const context = await shopper.context()
  for (const r of context.routines) {
    console.log(`   Routine: ${r.name} (${r.time_of_day}): ${r.steps.map(s => s.product_type).join(' → ')}`)
  }
  console.log()

  // ── 4. The agent personalizes ───────────────────────────────────────
  // Rank the store's own products for them. Anything with an ingredient
  // they must avoid comes back with `avoid: true`, and the agent drops it.
  const ranked = await shopper.rank(catalog, { limit: catalog.length })
  const byId = new Map(catalog.map(p => [p.id, p]))
  const picks = ranked.items.filter(i => !i.avoid && i.match !== null).slice(0, 3)
  const avoided = ranked.items.filter(i => i.avoid)
  const unanswered = [...new Set(ranked.items.map(i => i.missing_quiz).filter(Boolean))]

  console.log('3. Picked for them:')
  for (const item of picks) {
    const p = byId.get(item.id)!
    console.log(`   ${Math.round(item.match ?? 0)}%  ${p.name} ($${p.price})`)
    for (const reason of item.reasons.slice(0, 2)) console.log(`         ✓ ${reason}`)
    for (const warning of item.warnings) console.log(`         ! ${warning}`)
  }
  if (avoided.length) {
    console.log(`   Left out: ${avoided.map(i => byId.get(i.id)!.name).join(', ')} (${avoided[0]!.warnings[0] ?? 'contains something they avoid'})`)
  }
  if (unanswered.length) {
    console.log(`   Not scored: ${unanswered.join(', ')}. They haven't answered that quiz, so the agent asks rather than guesses.`)
  }

  // An LLM-based agent would put this in its system prompt instead of
  // printing it: the shopper's own facts, never invented.
  console.log('\n4. What the agent would say:')
  const top = picks[0] && byId.get(picks[0].id)
  console.log(top
    ? `   "Based on your Hallie profile, I'd start with the ${top.name}: ${picks[0]!.reasons[0]?.toLowerCase() ?? 'it suits you'}.` +
      (h.never_recommend.length ? ` I've skipped anything with ${h.never_recommend.slice(0, 2).join(' or ')}."` : '"')
    : '   "Tell me a little more about what you need and I\'ll find something."')
}

main().catch(err => {
  if (err instanceof HaliteError) console.error(`Halite answered ${err.status} ${err.code}: ${err.message}`)
  else console.error(err)
  process.exit(1)
})
