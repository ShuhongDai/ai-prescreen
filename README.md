# AI初筛 · ai-prescreen

A fast, rule-based first-pass screener for telltale AI-generated wording in English drafts.

Paste text copied from LaTeX, Markdown or Word and the page instantly highlights
leftover chatbot artifacts ("Certainly! Here is a possible introduction…") and
overused LLM vocabulary ("delve into", "underscore", "pivotal").

**This is a self-check linter, not an AI detector.** It never estimates an "AI
probability". It points out wording that may read as templated or AI-like so you can
decide whether to revise it.

- **Rule-based only.** A curated lexicon and simple rules, no ML models or LLM calls.
- **Private.** Your text stays in your browser. The page sends anonymous usage statistics
  (never your text, no cookies) and the reports you choose to send; a report form also loads Cloudflare Turnstile, an anti-spam
  check. See [Privacy](#privacy).
- **Instant.** Analysis runs locally as you paste.

> Status: early development. Live at https://aiprescreen.fyi — checks for
> chatbot artifacts (tier 1), over-used LLM vocabulary (tier 2) and, at sensitivity Strict,
> style signals (tier 3).

## Detection tiers

| Tier | Meaning | Example |
|---|---|---|
| `artifact` | Chatbot leftovers: almost always worth fixing | "Certainly! Here is…", "As an AI language model", "[Insert citation]" |
| `lexical` | Overused LLM words and phrases: you decide | delve, underscore, pivotal, "plays a crucial role in" |
| `stylistic` | Weak signals, shown only at sensitivity Strict | "In conclusion," openers, "not only … but also" |

## Privacy

The text you paste is analysed in your browser and never sent anywhere. To learn how the site
is used, the page sends anonymous usage statistics to its own API (`api.aiprescreen.fyi`, a
Cloudflare Worker) and, once configured, page views to Cloudflare Web Analytics.

**What is collected**, per page view:

- from the page: the referring site (host name only, e.g. `news.ycombinator.com`), `utm_*`
  campaign tags in the URL, the browser's language, the window width (as a range), light or
  dark mode, whether it is a touch screen;
- what you do on the page: pasting or typing (not the text), the length of an analysed draft
  in words and how many highlights of each kind it got (as ranges), which highlights you open
  or mark as "Not AI-like" (lexicon entry IDs), the example, settings you change, opening the
  report form (not whether or when you sent a report); how long the page was visible and how
  far you scrolled; times are rounded to the minute;
- from Cloudflare's network: country, region and city, and the operator of the network
  (e.g. a university or an internet provider), looked up from your IP address;
- browser and operating system family (e.g. "Firefox", "Windows") read from the User-Agent;
- which lexicon entries fired (entry IDs, counted per day), as before.

**What is not collected or kept**: your text; your IP address and the User-Agent (used while
the request is handled, never stored); cookies or anything else stored on your device; any ID
that follows you from one day to the next. To count visitors per day, the API keeps a hash of
your IP address, User-Agent and a random value that is deleted after that day. Once the
random value is gone (the database's recovery copies keep it up to 7 more days), the hash can
no longer be traced back to an address or linked to another day. Visits on different days are
not linked by any identifier, though a visit's details (place, network, browser, window size)
are kept with it.

**Retention**: page views and events are deleted after 400 days; per-day totals (e.g. visits
per country) are kept. **Purpose and legal basis**: understanding how the tool is found and
used, to improve it (legitimate interest, GDPR Art. 6(1)(f)). **Who**: Shuhong Dai; questions,
requests and objections to this processing (GDPR Art. 21) through
[GitHub issues](https://github.com/ShuhongDai/ai-prescreen/issues).

## Development

Requires Node.js 24 LTS.

```sh
npm install
npm run dev        # Vite dev server on http://localhost:5173/
npm test           # type-check (tsc --noEmit), then Vitest
npm run build      # Vite build into dist/
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
