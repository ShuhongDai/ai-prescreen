# Clean-text fixtures

Every `*.txt` file in this folder is analysed by `tests/lexicon.test.ts` with the full
lexicon (all tiers, candidates included) and must produce **zero** tier-1 (`artifact`)
matches. Sources are listed here rather than inside the files, so that nothing but the
text itself is analysed.

| File | Source | Kind |
|---|---|---|
| `darwin-origin-of-species-1859.txt` | Charles Darwin, *On the Origin of Species*, 1st ed. (1859), closing paragraph, verbatim from Project Gutenberg eBook #1228. Public domain. | Human-written |
| `austen-pride-and-prejudice-1813.txt` | Jane Austen, *Pride and Prejudice* (1813), first two paragraphs of chapter 1, verbatim from Project Gutenberg eBook #1342. Public domain. | Human-written |
| `constructed-latex-related-work.txt` | Constructed for testing. LaTeX-style prose with `\cite{}`, numeric citations, editorial insertions (`[sic]`, `[...]`, `[had]`), and sentences *about* chatbots that mention artifact phrases inline or in quotes. | Constructed for testing (not human-written evidence) |
| `constructed-markdown-email.txt` | Constructed for testing. Markdown-flavoured email with a link, `[citation needed]`, an anonymised quote with `[Name]`, task-list checkboxes, inline code, and ordinary email phrases. | Constructed for testing (not human-written evidence) |
