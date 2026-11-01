# Shopping agent

An agent that asks Halite what a shopper wants, then picks products for them from a catalog, with reasons, and leaves out anything they must avoid.

```
1. The shopper authorizes the agent
2. The agent asks Halite for their context
3. Halite returns what they chose to share
4. The agent ranks the catalog for them and explains its picks
```

## Run it

You need a **test** secret key (`hk_test_…`). Create one at [developers.haliteintelligence.com](https://developers.haliteintelligence.com): sign in with your email, create an organization and an app, then open **API keys**.

```sh
npm install
HALITE_SECRET_KEY=hk_test_… npm start
```

Pick a different sample shopper with an argument:

```sh
npm start coily_routine        # 4C hair, a four-step wash-day routine
npm start fragrance_collector  # warm, sweet fragrances
npm start oily_acne_budget     # oily, acne-prone skin, a tight budget
```

Test keys only ever reach the six sandbox shoppers. They never see a real person.

## What to look at

- [`src/agent.ts`](src/agent.ts): the whole flow, about 100 lines.
- `shopper.summary()` returns the shopper in plain words, plus lists of what they're solving for, what to prefer and what never to recommend. It's built for an agent's prompt.
- `shopper.rank(products)` scores your own catalog for them. A product with something they avoid comes back with `avoid: true`. If they haven't answered a category's quiz, `match` is `null` and `missing_quiz` names the quiz: ask them, don't guess.

## In production

Step 1 is the OAuth consent screen, where the shopper chooses what to share. [`../merchant-personalization`](../merchant-personalization) shows that flow. Live calls to the intelligence endpoints need the Context Intelligence plan or higher.
