# AI初筛 · ai-prescreen

A fast, rule-based first-pass screener for telltale AI-generated wording in English drafts.

Paste text copied from LaTeX, Markdown or Word and the page instantly highlights
leftover chatbot artifacts ("Certainly! Here is a possible introduction…") and
overused LLM vocabulary ("delve into", "underscore", "pivotal").

**This is a self-check linter, not an AI detector.** It never estimates an "AI
probability". It points out wording that may read as templated or AI-like so you can
decide whether to revise it.

- **Rule-based only.** A curated lexicon and simple rules, no ML models or LLM calls.
- **Private.** Your text never leaves the browser.
- **Instant.** Analysis runs locally as you paste.

> Status: early development. Live at https://shuhongdai.github.io/ai-prescreen/ — checks for
> chatbot artifacts (tier 1). A tier-2 lexicon of over-used words is under review and can be
> tried with the "Experimental lexicon" toggle.

## Detection tiers

| Tier | Meaning | Example |
|---|---|---|
| `artifact` | Chatbot leftovers: almost always worth fixing | "Certainly! Here is…", "As an AI language model", "[Insert citation]" |
| `lexical` | Overused LLM words and phrases: you decide | delve, underscore, pivotal, "plays a crucial role in" |
| `stylistic` | Weak signals, off by default | em-dash density, "In conclusion," openers |

## Development

Requires Node.js 24 LTS.

```sh
npm install
npm run dev        # Vite dev server on http://localhost:5173/ai-prescreen/
npm test           # Vitest
npm run build      # type-check and build into dist/
```

Project layout:

```
web/            frontend (Vite + TypeScript, no framework)
web/src/engine/ detection engine (pure TypeScript, no DOM)
lexicon/        lexicon JSON files
tests/          Vitest tests
```

## Licence

- Code: [MIT](LICENSE)
- Lexicon (`lexicon/`): [CC BY 4.0](lexicon/LICENSE)
