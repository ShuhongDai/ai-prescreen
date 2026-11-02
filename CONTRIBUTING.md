# Contributing to ai-prescreen

ai-prescreen is a self-check linter: it highlights wording that may read as templated or
AI-like, and the author decides what to change. The lexicon behind it grows from reports
and pull requests.

## Report from the site

Reports become **public GitHub issues**; you do not need a GitHub account.

- **A phrase that should be flagged:** select it in the result pane and click
  **Report as AI-like**, or use **Report a phrase** under *Advanced*. A form opens with the
  phrase filled in. Choose a tier; an example sentence and the model it came from are
  optional.
- **A highlight on ordinary wording (false positive):** click the highlight, then
  **Report false positive**. The form shows the entry and the highlighted words; an
  example sentence and a comment are optional. Once the report is sent, the page hides
  that entry for the rest of your session.

**Send report** goes through the site's API (`api.aiprescreen.fyi`), which runs a
Cloudflare Turnstile check against spam and opens the issue. **Open on GitHub instead**
opens the same form on GitHub
([phrase](https://github.com/ShuhongDai/ai-prescreen/issues/new?template=report-ai-phrase.yml),
[false positive](https://github.com/ShuhongDai/ai-prescreen/issues/new?template=report-false-positive.yml)),
filled in with the phrase, or with the entry id and the highlighted words.

Besides the reports you send, the page sends only anonymous hit counts: which lexicon
entries fired (their IDs, never your text), a few seconds after an analysis, each entry at
most once per page view. Switch them off under *Advanced*; they are off by default if your
browser sends Global Privacy Control.

## Change the lexicon with a pull request

The lexicon lives in `lexicon/*.json`, one file per language and tier:
`en.artifact.json` (tier 1, chatbot leftovers) and `en.lexical.json` (tier 2, over-used
words). Each file is a JSON array of entries:

```json
{
  "id": "en.lexical.delve",
  "pattern": "delve",
  "match": "word",
  "inflect": true,
  "tier": "lexical",
  "lang": "en",
  "status": "candidate",
  "note": "One or two neutral sentences shown in the popover.",
  "suggestions": ["examine", "explore", "look at"],
  "models": [],
  "added": "2026-10-23",
  "evidence": [{ "type": "paper", "ref": "Kobak et al. 2025, excess vocabulary", "url": "https://…" }],
  "independentSources": 1
}
```

- `id` is `<lang>.<tier>.<kebab-slug>` and never changes once published.
- `match` is `word`, `phrase` (whitespace matches any whitespace) or `regex` (compiled
  with flags `gimu`; keep it linear, no nested unbounded quantifiers). Matching is
  case-insensitive with word boundaries.
- `inflect: true` adds verb and noun forms of a base-form pattern (`delve` → `delves`,
  `delved`, `delving`; British `-ise` spellings too).
- `note` must not say or imply that text is AI-generated; describe the wording
  ("a stock phrase in chatbot-style prose", "may read as templated").
- `evidence` lists short citations and URLs, **never copied passages**. A source that only
  repeats another source's list gets `"derivedFrom": "<that source's ref>"`;
  `independentSources` counts the other items.
- `status`: new entries are always `candidate`. Only the maintainer sets `accepted`,
  `watch` or `retired`. Candidates show on the site only with *Advanced → Experimental
  lexicon*.

Before opening the PR:

```sh
npm install
npm run validate-lexicon   # schema, unique ids, valid regexes, no duplicate patterns
npm test
```

If you change lexical entries, the human baseline must be re-measured with
`npm run baseline` (it needs the arXiv sample: `npm run fetch-arxiv -- --ids data/arxiv-sample-ids.txt`).
The maintainer can do this for you.

Code changes are welcome too. The page must make no network requests while analysing,
and new runtime dependencies need discussion first.

## Review policy

- Lexicon decisions (accepting, retiring, changing tier) are made by the maintainer,
  Shuhong Dai.
- Both tiers prefer recall: tier 1 flags chatbot leftovers wherever they appear, and
  tier 2 accepts broadly. The page stays readable through the tier-2 sensitivity setting,
  which filters by each entry's *human fire-rate*: the share of pre-2022 arXiv abstracts
  an entry fires in.
- Large batches are reviewed by looking at the highest-firing entries individually plus a
  random sample, then accepting or rejecting the batch.
- Reports are collected with `npm run triage`: new phrases become candidates (or evidence
  on an existing entry) and false positives are counted per entry. After the decision,
  each report gets a short comment and is closed; reports whose entry is still a
  candidate stay open.

## Licence

Code: MIT ([LICENSE](LICENSE)). Lexicon: CC BY 4.0 ([lexicon/LICENSE](lexicon/LICENSE)).
By contributing you agree that your contribution is released under these licences.
