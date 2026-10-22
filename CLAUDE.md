# ai-prescreen

A fast, rule-based first-pass screener for telltale AI-generated wording in English drafts.
Users paste text copied from LaTeX, Markdown or Word; the page instantly highlights
leftover chatbot artifacts ("Certainly! Here is a possible introduction…") and
overused LLM vocabulary ("delve into", "underscore", "pivotal").

Owner: Shuhong Dai (GitHub: ShuhongDai). Personal side project, fully open source.
Repo: github.com/ShuhongDai/ai-prescreen. Site: GitHub Pages.

## What this project is — and is not

- IS: a self-check style linter for authors. Instant, local, no waiting.
- IS NOT: an "AI detector". Never output an "AI probability" or wording like
  "this text is AI-generated". Say "may read as templated / AI-like; consider revising".
- IS NOT model-based. The detection path uses rules and a curated lexicon only.

## Hard rules (do not break without asking Shuhong)

1. No ML models, no LLM/API calls anywhere in the detection path.
2. Pasted text never leaves the browser. The page makes zero network requests while
   analyzing: no external fonts, no CDNs, no analytics, no trackers.
   The only network traffic is user-initiated feedback (M3/M4) and, from M4, anonymous
   hit counts that contain lexicon entry IDs only — disclosed on the page, can be switched off.
   An example sentence is uploaded only if the user explicitly ticks a box.
3. Lexicon decisions (accepting entries, changing tier, retiring) are Shuhong's.
   Claude may propose entries, but only with `"status": "candidate"`.
4. Minimal dependencies. Ask before adding any runtime dependency.
5. Git: never modify global git config. Push only to github.com/ShuhongDai/ai-prescreen.
   Never add GitLab (or any other) remotes. Before the first commit, verify that
   `git config user.email` shows the `…@users.noreply.github.com` address.
6. Secrets (Cloudflare API token, GitHub tokens) are never committed.
   They live in `.env` (gitignored, `chmod 600`) or in GitHub/Cloudflare secrets.
7. Remote database: reading is fine. Any `--remote` write, delete or schema change
   requires explicit confirmation from Shuhong first. Migrations are append-only:
   never edit an existing migration file, always add a new one.
8. Work directly on `main` and push without asking for confirmation. Run `npm test` and
   `npm run validate-lexicon` locally before pushing. If a check fails, mention it in the
   report. CI only builds and deploys; it runs no tests, linters or format checks.
   External contributions come in as PRs.

## Detection tiers

| Tier | ID | Meaning | Example | UI |
|---|---|---|---|---|
| 1 | `artifact` | Chatbot leftovers; almost zero false positives; must fix | "Certainly! Here is…", "As an AI language model", "as of my last knowledge update", "[Insert citation]", "Regenerate response", stray `**bold**` / `###` | red, solid underline + icon |
| 2 | `lexical` | Overused LLM words/phrases; author decides | delve, underscore, pivotal, intricate, "plays a crucial role in" | yellow, wavy underline |
| 3 | `stylistic` | Weak signals; off by default | em-dash density, "not only… but also", "In conclusion," openers | grey, dotted underline |

Tier must never be conveyed by colour alone (underline style + icon as well).
Keep tier 2 restrained: common academic words (robust, comprehensive, notably) are
not entries, or are flagged only when density is abnormal. Every highlight should be
worth the user's attention.

## Lexicon

Single source of truth: `lexicon/*.json` (one file per tier/language, e.g. `en.artifact.json`).
Licence: lexicon CC BY 4.0, code MIT.

Entry schema:

```json
{
  "id": "en.lexical.delve-into",
  "pattern": "delve into",
  "match": "phrase",            // "word" | "phrase" | "regex"
  "inflect": true,              // engine generates delves/delved/delving
  "tier": "lexical",
  "lang": "en",
  "status": "accepted",         // candidate | accepted | watch | retired
  "note": "Strongly over-represented in LLM-polished academic text since 2023.",
  "suggestions": ["examine", "explore", "look at"],
  "models": [],                 // optional: model families where observed
  "added": "2026-10-22",
  "evidence": [
    { "type": "paper", "ref": "Kobak et al., excess vocabulary", "url": "https://…" },
    { "type": "blog", "ref": "Some blog", "derivedFrom": "Kobak et al., excess vocabulary" }
  ],
  "independentSources": 1        // evidence items without "derivedFrom"
}
```

- `evidence` lists the sources consulted for the entry: short citations and URLs only, never
  copied passages. An item that only repeats another source's list carries `derivedFrom`;
  `independentSources` counts the other items (the validator checks it).

- Only `accepted` (and `watch`, shown normally) entries are active by default; `candidate`
  entries appear only with an "experimental lexicon" toggle; `retired` are ignored.
- Runtime statistics (hit counts, false-positive reports, last reported) live in the
  database (M4), not in the JSON, to keep lexicon diffs clean.
- `npm run validate-lexicon` (run locally, not in CI) validates every lexicon file:
  schema, unique IDs, valid regexes, no duplicate patterns.
- Review of large batches: Shuhong reviews the highest-firing entries (by human fire-rate)
  individually plus a random sample, and then accepts or rejects whole batches.

## Engine requirements (`src/engine/`, pure TypeScript, no DOM)

- Scope: no text-type classification. Do not special-case literature, emails or quoted AI
  output. The UI will carry a short disclaimer later ("self-check tool; you judge your own
  text"). The existing M1 same-line quote heuristic inside the artifact regexes stays as it is.
- Input: raw pasted text. Output: list of matches `{entryId, tier, start, end}` with
  offsets into the ORIGINAL text, plus summary stats (counts per tier, hits per 1,000 words).
- Preprocessing must keep an offset map back to the original text:
  - join PDF/LaTeX hyphenation breaks (`compre-\nhensive`)
  - normalise curly quotes/apostrophes and whitespace
  - LaTeX: skip math (`$…$`, `\[…\]`, equation-like environments), `\cite{}`, `\ref{}`,
    `\label{}`, comments; keep the text arguments of formatting commands (`\emph{…}`)
  - Markdown: skip code blocks and inline code; do NOT strip `**`/`###` before
    artifact matching (they are tier-1 signals themselves)
- As built (M2, `preprocess.ts`): one uniform pass, no input-type detection. Skipped text
  is masked with spaces (newlines kept), so line-anchored artifact regexes still work.
  `%` starts a comment only at a line start, after whitespace, `}` or `\\`, or at a line
  end — never after a digit ("20%", "5 wt%") or inside a URL; inline `$…$` follows
  Pandoc's rule and never opens right after a digit ("$5 and $10", "5$" are not math);
  only *closed* backtick fences mask their content (fence lines stay visible; `~~~` is not
  a fence); inline code uses flanking rules and LaTeX ``…'' quotes are not code; inline
  code and `$…$` keep their delimiters visible; `\url{}`/`\href{}` URLs stay visible.
- Overlaps are settled tier by tier (artifact, then lexical, then stylistic) and, within a
  tier, reviewed entries (accepted/watch) before candidates; each layer only fills gaps
  (earliest start, then longest, then id). So a tier-1 artifact is never hidden by a word
  inside it, and the experimental lexicon never replaces a reviewed match of its tier. A hyphen in a pattern matches "-", whitespace or
  nothing ("cutting-edge" matches "cutting edge", "cuttingedge").
- Matching: case-insensitive, word boundaries, inflection for `inflect: true`.
  Word/phrase entries are indexed by their first word (all forms) and checked with one
  pass over the text; regex entries are scanned. Inflection (`inflect.ts`) gives every
  content word of a base-form pattern its verb/noun forms, a small irregular table and
  -ize/-ise variants; it cannot tell nouns from verbs (landscape → landscaping).
- Performance target: 20,000 words analysed in < 100 ms on a normal laptop.
- Tests with Vitest, including a false-positive regression set of clean human text
  that must produce no tier-1 hits.

## Frontend (`web/`)

- Vite + TypeScript, no framework. Plain CSS with variables; light/dark via
  `prefers-color-scheme`; system font stack.
- Layout: left = plain textarea (on paste, take `text/plain` only); right = read-only
  highlighted result. Stacked on mobile. No in-place highlighting inside the editor (v1).
- Summary line on top of results, e.g. "2 artifacts · 7 overused words · 3.1 per 1k words".
  The per-1k density is shown only from 200 words up (`DENSITY_MIN_WORDS`), followed by the
  human baseline "typical human papers (2019–21): ~X" (`web/src/baseline.json`: lexical
  hits per 1k words on the arXiv measuring stick with the default lexicon; left out while
  experimental matches are shown).
- Clicking a highlight opens a popover: tier, why it is flagged, suggestions,
  "Not AI-like (false positive)" button. Until M3 the button only hides that entry for
  the page session (memory only, Undo in the summary); M3 adds reporting in
  `onFalsePositive()` in `main.ts`.
- The build strips `evidence`, `models` and `independentSources` from the bundled lexicon
  (`vite.config.ts`); the page needs only patterns, notes and suggestions.
- Visual style: clean, minimal, editor-like. Iterate from screenshots.
- UI language: English. Product name shown as "AI初筛 · ai-prescreen".
- Vite `base` must be `/ai-prescreen/` for GitHub Pages.

## Architecture

- Frontend: static build → GitHub Pages via GitHub Actions.
- Backend (from M4): Cloudflare Worker + D1 (SQLite) + Turnstile (anti-spam), free tier.
  The Worker stores feedback and anonymous counts, rate-limits by IP, and can open
  GitHub issues for triage using a token stored as a Worker secret.
- Everything is configured as code in this repo (`wrangler.toml`, `migrations/*.sql`,
  `.github/workflows/*`). No manual dashboard work after initial account setup.

```
ai-prescreen/
├── CLAUDE.md
├── README.md
├── LICENSE              # MIT (code)
├── lexicon/             # JSON lexicon, CC BY 4.0 (LICENSE inside)
├── web/                 # frontend (Vite)
│   └── src/engine/      # detection engine, no DOM
├── worker/              # Cloudflare Worker (M4)
│   ├── src/
│   ├── migrations/
│   └── wrangler.toml
├── scripts/             # maintenance: validate lexicon, pull feedback, stats, backups
├── tests/
└── .github/
    ├── ISSUE_TEMPLATE/  # "report AI-like phrase", "report false positive"
    └── workflows/       # deploy-pages, deploy-worker, backup (build + deploy only)
```

## Milestones (do one at a time; stop and report after each)

- **M0 Bootstrap** — check environment; scaffold Vite + TS + Vitest; `.gitignore`
  (incl. `.env`, `node_modules`, `dist`), README, licences; create the public GitHub repo
  with `gh repo create ShuhongDai/ai-prescreen --public`; push `main`.
  Done when: repo exists, `npm test` passes, `npm run build` works.
- **M1 Artifact tier + minimal UI + deploy** — engine with tier-1 matching, two-pane UI,
  GitHub Actions deploying to Pages. Done when: the live site flags a pasted
  "Certainly! Here is a revised version…" correctly.
- **M2 Lexical tier** — inflection, LaTeX/Markdown preprocessing with offset map,
  summary line, popover with explanation and suggestions, seed tier-2 lexicon (candidates
  for Shuhong to review). Done when: tests incl. false-positive set pass; perf target met.
  Notes:
  - Use pre-2022 arXiv abstracts (CC0 metadata) only as a measuring stick: for each lexical
    candidate, compute the share of human abstracts it fires in. This is a lexicon-quality
    metric, not engine logic.
- **M3 Contribution flow v1 (no backend)** — "report phrase" / "false positive" buttons
  open pre-filled GitHub issues; issue templates; lexicon validation as a local script
  (`npm run validate-lexicon`);
  CONTRIBUTING.md.
- **M4 Backend** — Worker + D1 + Turnstile; feedback and false-positive endpoints;
  anonymous entry-ID hit counts; Worker → GitHub issue. Privacy note on the page.
- **M5 Maintenance tooling** — scripts to pull and summarise feedback, offline corpus
  frequency check for candidate entries (human vs AI-polished text; runs offline, never
  in the product), scheduled D1 backup (`wrangler d1 export`).

## Development environment

- Host: IFI cluster **headnode** (shared machine). Lightweight work only.
- Node via nvm (v24 LTS); `gh` in `~/.local/bin`, logged in as ShuhongDai (HTTPS).
- `gh` token is stored in plain text in `~/.config/gh/hosts.yml` (chmod 600).
- Git identity switches automatically via `includeIf "gitdir:~/projects/personal/"`
  → noreply email. Global identity (UIBK email) is for work repos; leave it alone.
- Preview in the browser via SSH port forwarding from Shuhong's laptop:
  `ssh -L 5173:localhost:5173 -L 8787:localhost:8787 <user>@<headnode>`
  (5173 = Vite dev server, 8787 = `wrangler dev`).
- Cloudflare (M4): `wrangler login` does not work well on a remote host; use
  `CLOUDFLARE_API_TOKEN` from `.env` instead.

## Commands

Single root `package.json`; Vite `root` is `web/`, build output goes to `dist/`.

```
npm install
npm run dev        # Vite dev server → http://localhost:5173/ai-prescreen/
npm test           # tsc --noEmit, then Vitest (tests/**/*.test.ts, web/src/**/*.test.ts)
npm run test:watch
npm run validate-lexicon  # schema, unique IDs, valid regexes, no duplicate patterns
npm run build      # vite build → dist/ (this is all CI runs, then deploys to Pages)
npm run preview    # serve dist/ locally
npm run fetch-arxiv       # draw the pre-2022 arXiv sample → data/arxiv/ (gitignored);
                          # `-- --ids data/arxiv-sample-ids.txt` re-fetches the committed sample
npm run fire-rate -- --tier lexical --status candidate [--review reviews/<name>.md]
                          # human fire-rate per entry on that sample (measuring stick only)
npm run baseline          # recompute web/src/baseline.json after changing which lexical
                          # entries are accepted (tests/baseline.test.ts fails until you do)
```

Before every push: `npm test && npm run validate-lexicon`.

Files: everything for this project stays inside this folder. Review files for Shuhong go in
`reviews/` (gitignored); temporary files go in the session scratchpad.

## Decision log

- 2026-10-22 — Positioning: self-check linter, not a detector. Rule-based only.
- 2026-10-22 — Tiers: artifact / lexical / stylistic. Crowdsourced lexicon with
  candidate → accepted → watch → retired lifecycle; Shuhong approves.
- 2026-10-22 — Hosting: GitHub Pages + Cloudflare Workers/D1 (free tier). All config as code.
- 2026-10-22 — Stack: Vite + TypeScript, no framework, plain CSS; engine separate from UI.
- 2026-10-22 — Licences: MIT (code), CC BY 4.0 (lexicon).
- 2026-10-22 — Solo workflow: push directly to `main` without confirmation; no PRs for my own
  work; external contributions come in as PRs; no branch protection; CI = build + deploy only;
  tests and lexicon validation run locally.
- 2026-10-23 — Tier-2 batch rule: retire the top-30 firers; accept everything else. Self-check
  tool, so prefer recall over precision. Revisit the 1–5% band if default noise turns out too high.