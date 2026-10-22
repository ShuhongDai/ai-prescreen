# Clean-text fixtures

Every `*.txt` file in this folder is analysed by `tests/lexicon.test.ts` with the full
lexicon (all tiers, candidates included) and must produce **zero** tier-1 (`artifact`)
matches. Sources are listed here rather than inside the files, so that nothing but the
text itself is analysed.

| File | Source | Kind |
|---|---|---|
| `darwin-origin-of-species-1859.txt` | Charles Darwin, *On the Origin of Species*, 1st ed. (1859), closing paragraph, verbatim from Project Gutenberg eBook #1228. Public domain. | Human-written |
| `austen-pride-and-prejudice-1813.txt` | Jane Austen, *Pride and Prejudice* (1813), first two paragraphs of chapter 1, verbatim from Project Gutenberg eBook #1342. Public domain. | Human-written |

Two constructed fixtures (a LaTeX related-work paragraph quoting chatbot phrases, and a
Markdown email) were removed on 2026-10-23: under the recall policy for tier 1, quoted
chatbot phrases and email closers are meant to be flagged, so they are no longer clean.
The pre-2022 arXiv sample is the broader measuring stick (`npm run fire-rate -- --tier artifact`).
