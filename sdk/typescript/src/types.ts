/** Response shapes. They mirror the OpenAPI document at /v1/openapi.json. */

export type Scope =
  | 'profile.read'
  | 'preferences.read'
  | 'interests.read'
  | 'purchases.read'
  | 'purchases.retailers.read'
  | 'context.read'
  | 'context.write'
  | 'offline_access'

export type CategoryKey =
  | 'beauty.skincare' | 'beauty.body' | 'beauty.hair' | 'beauty.makeup' | 'beauty.fragrance'
  | 'beauty.nails' | 'beauty.wellness' | 'beauty.sun_care' | 'beauty.lip_care' | 'beauty.eye_care'

export type EventType = 'consent.granted' | 'consent.updated' | 'consent.revoked' | 'consent.expired' | 'consumer.context.updated'

export interface Tokens {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token?: string
  scope: string
  consumer_id: string
}

export interface Consumer { id: string; name: string | null; email: string | null; categories: string[] }

/** Everything they named, main concern first, and the main one on its own. */
export interface Concerns {
  concerns: string[]
  primary_concern: string | null
  secondary_concerns: string[]
}

export interface HandleWithCare {
  ingredient: string
  /** `allergy` and `avoids`: never recommend. `reacts`: a strong active — recommend only with a warning. */
  reason: 'allergy' | 'avoids' | 'reacts'
  note: string
}

export interface Preferences {
  consumer_id: string
  skin: ({ type: string | null; tone: string | null } & Concerns) | null
  hair: ({ type: string | null; texture: string | null } & Concerns) | null
  /** Body care, separate from the face. */
  body: ({ type: string | null; texture: string | null; scent: string | null } & Concerns) | null
  makeup: { finish: string | null; coverage: string | null; undertone: string | null } | null
  fragrance: { families: string[]; intensity: string | null; longevity: string | null } | null
  sensitivity: string | null
  ingredients: { liked: string[]; avoided: string[]; cautioned: string[] }
  handle_with_care: HandleWithCare[]
  /** Two things they said that pull against each other. */
  tensions: Array<{ categories: string[]; note: string }>
  routine_complexity: 'minimal' | 'moderate' | 'extensive' | null
  /** 0–1: how much there is to go on. */
  confidence: number
}

export interface Interests {
  consumer_id: string
  categories: string[]
  /** The highest of `budgets`. */
  budget: { per_product_max: number; currency: string } | null
  budgets: Array<{ category: string; per_product_max: number; currency: string }>
  occasions: string[]
  shopping_for: string[]
}

export interface OwnedProduct {
  id: string
  name: string
  brand: string
  category: string
  product_type: string
  retailer: string | null
  acquired_at: string | null
  rating: number | null
  would_repurchase: boolean | null
  outcome: 'loved' | 'liked' | 'neutral' | 'disliked' | 'reacted' | null
  outcome_tags: string[]
}

export interface Purchases { consumer_id: string; products: OwnedProduct[] }

export interface Context {
  consumer_id: string
  outcomes: { positive: string[]; negative: string[] }
  aggregates: Array<{ category: string; product_type: string; attributes: string[]; avg_rating: number | null; products_count: number; repurchase_rate: number | null }>
  routines: Array<{ name: string; category: string; time_of_day: 'am' | 'pm' | 'any'; days_used_last_30: number | null; steps: Array<{ order: number; product_type: string; attributes: string[] }> }>
  seasonal: { season: string; direction: string; favour: string[] } | null
  replenishment: Array<{ category: string; product_type: string; typical_days: number }>
}

export interface Consent {
  consumer_id: string
  environment: 'test' | 'live'
  status: string
  scopes: string[]
  token_scopes: string[]
  categories: string[]
  granted_at: string
}

export interface AppInfo {
  id: string
  name: string
  environment: 'test' | 'live'
  client_id: string
  production_status: string
  organization: { id: string; name: string }
}

export interface Grant {
  consumer_id: string
  persona: string
  status: 'active' | 'revoked'
  scopes: string[]
  categories: string[]
  granted_at: string
  revoked_at: string | null
}

export interface Persona {
  key: string
  label: string
  scenario: string
  revoked: boolean
  name: string
  email: string
  categories: string[]
}

export interface HaliteEvent {
  id: string
  type: EventType | 'ping'
  created: number
  environment: 'test' | 'live'
  data: { consumer_id?: string; scopes?: string[]; categories?: string[]; revoked_by?: string; [key: string]: unknown }
}

export interface EventPage { events: HaliteEvent[]; has_more: boolean; next_after: string | null }

/** A product of yours to rank. Only id and name are required; the more you send, the sharper the ranking. */
export interface RankProduct {
  id: string
  name: string
  price?: number
  currency?: string
  /** A category key such as beauty.skincare. */
  category?: string
  /** Serum, shampoo… keeps recommendations varied and matches replenishment. */
  product_type?: string
  ingredients?: string[]
  key_ingredients?: string[]
  /** What it is for, in any words: "dark spots", "dryness". */
  concerns?: string[]
  attributes?: string[]
  in_stock?: boolean
}

export interface Ranked {
  consumer_id: string
  confidence: number
  /** `match` is null when `missing_quiz` names a category quiz they haven't taken: ask them, don't guess. */
  items: Array<{ id: string; rank: number; match: number | null; missing_quiz: CategoryKey | null; reasons: string[]; warnings: string[]; avoid: boolean }>
}

export interface Summary {
  consumer_id: string
  summary: string
  confidence: number
  categories: string[]
  highlights: {
    solving_for: string[]
    prefer: string[]
    never_recommend: string[]
    recommend_with_warning: string[]
    budgets: Array<{ category: string; per_product_max: number; currency: string }>
    tensions: string[]
  }
}

/** What the consumer did in your app (context.write). */
export type ContextEventType = 'product_viewed' | 'product_saved' | 'added_to_cart' | 'purchased' | 'returned' | 'rated' | 'searched'

export interface ContextEvent {
  /** Your id for the event: sending it again is a no-op, so retries are safe. */
  id: string
  type: ContextEventType
  /** ISO 8601, within the last year. */
  occurred_at: string
  /** A category the consumer shared with your app. */
  category: CategoryKey
  /** Required for every type except searched. */
  product?: {
    id: string; name: string; brand?: string; product_type?: string; price?: number; currency?: string
    /** What it is like: "fragrance-free", "gel", "ceramides". This is what enriches the profile. */
    attributes?: string[]
    ingredients?: string[]
  }
  /** 1–5; required for rated. */
  rating?: number
  quantity?: number
  /** Required for searched. */
  query?: string
  note?: string
}

export interface ContextEventsAccepted {
  consumer_id: string
  events: Array<{ id: string; status: 'stored' | 'duplicate' }>
}

export interface ContextEventPage {
  consumer_id: string
  events: Array<ContextEvent & { received_at: string; product: ContextEvent['product'] | null }>
  /** Pass as `before` for the next page; null on the last one. */
  next_before: string | null
}

export type Verdict = 'strong' | 'good' | 'fair' | 'weak' | 'avoid' | 'needs_quiz'

export interface Compatibility {
  consumer_id: string
  id: string
  match: number | null
  missing_quiz: CategoryKey | null
  verdict: Verdict
  reasons: string[]
  warnings: string[]
  avoid: boolean
}

export interface Recommendations {
  consumer_id: string
  confidence: number
  /** Ids of the best picks, best first. */
  best_picks: string[]
  /** Every product sent, best first: nothing is left out, everything is flagged. */
  items: Array<{
    id: string; rank: number; match: number | null; missing_quiz: CategoryKey | null; best_pick: boolean; why: string; reasons: string[]; warnings: string[]
    avoid: boolean
    /** Above what they usually spend here. Informs; does not exclude. */
    over_budget: boolean
    in_stock: boolean
  }>
}

export interface Replenishment {
  consumer_id: string
  sufficient_data: boolean
  reason: string | null
  items: Array<{
    category: string
    product_type: string
    typical_days: number
    product: { id: string; name: string; brand: string } | null
    last_bought_on: string | null
    due_on: string | null
    /** Negative once overdue. */
    days_left: number | null
    status: 'overdue' | 'due_soon' | 'cadence_only'
    confidence: number
    suggestions: Array<{ id: string; match: number | null; same_product: boolean; reasons: string[] }>
  }>
}

export interface Intent {
  consumer_id: string
  query: string
  shopping_for: 'self' | 'someone_else'
  /** Fixed rules always run first; a model fills in only what they could not. */
  interpreted_by: 'rules' | 'rules+model'
  filters: {
    categories: string[]
    product_types: string[]
    concerns: string[]
    avoid_ingredients: string[]
    caution_ingredients: string[]
    max_price: { amount: number; currency: string } | null
    skin_type: string | null
    hair_type: string | null
  }
  /** Where each filter came from. */
  sources: Partial<Record<string, 'request' | 'profile' | 'both'>>
  /** Categories the request named that the consumer has not shared with your app. */
  not_shared: string[]
  summary: string
}

export interface EnrichedValue { value: string; source: 'stated' | 'inferred' | 'both'; evidence: string | null; strength: number }

export interface Enriched {
  consumer_id: string
  confidence: number
  preferences: {
    liked_ingredients: EnrichedValue[]
    avoid_ingredients: EnrichedValue[]
    caution_ingredients: string[]
    product_types_that_work: Array<{ category: string; product_type: string; attributes: string[]; evidence: string; strength: number }>
    product_types_that_failed: Array<{ category: string; product_type: string; attributes: string[]; evidence: string; strength: number }>
    brands_that_worked: EnrichedValue[]
    routine: { complexity: string | null; source: 'stated' | 'inferred' | 'both' | null; routines: Array<{ name: string; category: string; time_of_day: string; steps: number; days_used_last_30: number | null }> }
    seasonal: { season: string; direction: string; favour: string[] } | null
  }
  conflicts: string[]
  inferred_count: number
  note: string | null
}
