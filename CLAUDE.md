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
2. Pasted text never leaves the browser unless the user reports it. The page makes zero
   network requests while analyzing: no external fonts, no CDNs, no analytics, no trackers.
   The only network traffic is user-initiated feedback and, from M4, anonymous hit counts
   that contain lexicon entry IDs only — disclosed on the page, can be switched off.
   M3 reports are links to public GitHub issue forms: the page prefills only the entry id
   and matched text (false positive) or the selected phrase (new phrase); the example
   sentence is an ordinary optional field the reporter fills in on GitHub (decision 2026-10-23).
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
| 1 | `artifact` | Chatbot leftovers; prefer recall (no exceptions for emails, literature or quotes); must fix | "Certainly! Here is…", "As an AI language model", "as of my last knowledge update", "[Insert citation]", "Regenerate response", stray `**bold**` / `###` | red pen: 2px solid underline + mark in the left margin |
| 2 | `lexical` | Overused LLM words/phrases; author decides | delve, underscore, pivotal, intricate, "plays a crucial role in" | highlighter: soft yellow background + thin wavy underline |
| 3 | `stylistic` | Weak signals; shown only at sensitivity Strict | "not only… but also", "In conclusion," openers, "it's not X, it's Y" (`en.stylistic.json`); density signals (em dashes per 1k words etc.) are postponed | pencil: grey dotted underline, no background |

Tier must never be conveyed by colour alone (underline style, margin mark or background as well).
Lexicon prefers recall (accept broadly); the default view stays readable via a
fire-rate-based sensitivity filter. Lexical batches are reviewed by human fire-rate (see
Lexicon): the top firers are retired, everything else is accepted. The page's tier-2
sensitivity setting shows lexical entries by their human fire-rate — Off = none, Loose ≤
0.25% (and entries that fire on none), Standard ≤ 1% (default), Strict = all accepted
lexical entries. It is a display filter only: statuses never change. The summary line shows the
human baseline for the chosen level. Revisit the 1–5% band if default noise turns out too
high (decision log, 2026-10-23).

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
  `independentSources` counts the other items (the validator checks it). User reports add
  `{ "type": "user-report", "ref": "#<issue>", "url": "…" }` items (`npm run triage`).

- Only `accepted` (and `watch`, shown normally) entries are active by default; `candidate`
  entries appear only with an "experimental lexicon" toggle; `retired` are ignored.
- Runtime statistics (hit counts, false-positive reports, last reported) live in the
  database (M4), not in the JSON, to keep lexicon diffs clean.
- Files: `en.artifact.json` (tier 1), `en.lexical.json` (tier 2), `en.stylistic.json` (tier 3,
  regex pattern signals only; density-type signals are postponed).
- `npm run validate-lexicon` (run locally, not in CI) validates every lexicon file:
  schema, unique IDs, valid regexes, no duplicate patterns.
- Review of large batches: Shuhong reviews the highest-firing entries (by human fire-rate)
  individually plus a random sample, and then accepts or rejects whole batches.

## Engine requirements (`src/engine/`, pure TypeScript, no DOM)

- Scope: no text-type classification. Do not special-case literature, emails or quoted AI
  output. The page carries a short disclaimer instead ("Self-check tool. Highlights are
  hints, not verdicts; …", see Frontend). Artifact patterns do not skip quoted text either.
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
- Summary line as a reviewer's note, e.g. "3 to remove · 12 to consider · 7.3 per 1k words,
  typical ~8.6" (tier 3: "N style notes").
  The per-1k density is shown only from 200 words up (`DENSITY_MIN_WORDS`), followed by the
  human baseline "typical human papers (2019–21): ~X" (`web/src/baseline.json`: lexical
  hits per 1k words on the arXiv measuring stick with the default lexicon at the chosen
  tier-2 sensitivity; left out while experimental matches are shown).
- Tier-2 sensitivity select (Off (artifacts only) / Loose / Standard / Strict, default
  Standard) in the toolbar; the choice is saved in localStorage (wrapped in try/catch).
  With Off the summary line shows no baseline.
- Clicking a highlight opens a popover: tier, why it is flagged, suggestions,
  "Not AI-like (false positive)" (hides that entry for the page session, memory only, Undo
  in the summary) and "Report false positive" (opens the prefilled public GitHub form in a
  new tab and also hides the entry). Selecting text in the result shows a "Report as
  AI-like" link (prefilled new-phrase form). URLs are built in `web/src/ui/report.ts`.
- A short disclaimer sits near the result: "Self-check tool. Highlights are hints, not
  verdicts; you decide what to change and remain responsible for your text."
- The experimental-lexicon toggle and a "Report a phrase" link live in an "Advanced" area
  near the footer.
- The build strips `evidence`, `models` and `independentSources` from the bundled lexicon
  (`vite.config.ts`); the page needs only patterns, notes and suggestions.
- Visual style: see Design below. Iterate from screenshots.
- UI language: English. Product name shown as "AI初筛 · ai-prescreen".
- Vite `base` must be `/ai-prescreen/` for GitHub Pages.

## Design ("academic paper")

Concept: the left pane is the manuscript source; the right pane is a printed page being
proofread with a red pen, a highlighter and a pencil.

- Typography: result pane and headings in Source Serif 4, self-hosted (`web/src/fonts/`:
  woff2, Latin subset, weights 400 and 600, OFL; bundled by Vite, no external fonts). CJK
  fallback for "AI初筛": "Noto Serif CJK SC", "Songti SC", serif. Input pane monospace
  (ui-monospace, "SF Mono", Menlo, Consolas, monospace), since users paste LaTeX source.
  UI controls in the system sans stack at a small size, so they read as tool chrome.
- Colour (CSS variables, WCAG AA in both themes): light paper #FBF8F1, ink #1F1D1A, muted
  ink #6B655C, rules/borders #E4DDD0; dark "night paper" #1C1A17, ink #E8E2D6, with matching
  muted and rule tones.
- Tiers: artifact = red pen #B3261E, 2px solid underline plus a small red mark in the left
  margin of the line; lexical = highlighter (soft yellow ≈ #F3E3A0, reduced in dark mode)
  plus a thin wavy underline; stylistic = pencil, grey dotted underline, no background.
- Layout: one-line header ("AI初筛" in serif and a short muted tagline); one compact toolbar
  row (sensitivity select left, the summary right as a reviewer's note); the legend lives in
  a small "Key" popover; the result is a paper sheet with generous margins, a subtle shadow,
  line height ≈ 1.6 and text width ≤ about 70ch; the highlight popover is a margin
  annotation card (tier label in small caps, note, suggestions, report links); the
  disclaimer is a footnote under the sheet (small, superscript marker); the empty state
  offers "Try an example" (a short sample with all three tiers, shown at Strict for that
  view without saving the preference); on mobile the panes stack, the sheet is full width
  and the margins shrink.
- Highlight popover: on desktop a margin-note card in the sheet's right margin (the sheet
  keeps a note margin when there is room; text stays ≤ 70ch), with a thin connector line to
  the highlight, so it never covers the text being read; where there is no room it falls
  back to floating next to the highlight. Below 768px it is a bottom sheet; on resize or
  orientation change it is repositioned or closed. No fade-in: opaque from the first frame.
- Mobile: after a paste, the page scrolls to the result; the draft textarea is capped at
  about 8 lines.
- Summary colours: "N to remove" in the red-pen colour, "N to consider" in a highlighter
  tone dark enough for AA text contrast; style notes in ink.
- Keep visible focus states and screen-reader text; never trade accessibility for looks.

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
npm run triage            # open "report" issues → candidates/evidence + reviews/triage-<date>.md
npm run triage -- --close [--yes]   # after the decision: comment on and close processed issues
npm run baseline          # recompute web/src/baseline.json (per-entry fire counts and the
                          # baseline per sensitivity level, ~3 min) after changing lexical
                          # entries or their status (tests/baseline.test.ts fails until then)
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
- 2026-10-23 — M3: reports go to public GitHub issues through issue forms prefilled by URL;
  the example sentence is an ordinary optional field; no privacy warning beyond GitHub's own
  UI; no backend until M4 (Worker + D1 stays planned).
- 2026-10-23 — Tier 3 ships as pattern signals in `lexicon/en.stylistic.json` (sentence-initial
  conclusion/summary openers and Moreover/Furthermore, "not only … but", "it's not X, it's Y"),
  shown only at Strict; density-type signals (em dashes per 1k words etc.) are postponed. Visual
  design "academic paper" (see Design), with self-hosted Source Serif 4.
- 2026-10-23 — Tier 1 also prefers recall: artifact patterns no longer avoid emails, literature
  or quoted text, and the same-line quote heuristic is removed. Line anchors stay only where
  they define the artifact (Markdown syntax) or where the bare text is an everyday phrase
  ("Copy code", "Searched the web", "Thought for a few seconds").