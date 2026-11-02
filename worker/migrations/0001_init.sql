-- Anonymous statistics only: no text, no IP addresses, no client identifiers.

-- How often each lexicon entry fired: one count per page view in which it was shown,
-- aggregated per UTC day.
CREATE TABLE hits (
  day TEXT NOT NULL,       -- YYYY-MM-DD (UTC)
  entry_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, entry_id)
) WITHOUT ROWID;

-- Reports filed as GitHub issues through the Worker, per UTC day: per entry for false
-- positives (entry_id = '' for new phrases). The day's total is the daily cap's counter.
CREATE TABLE reports (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,      -- 'new-phrase' | 'false-positive'
  entry_id TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, entry_id)
) WITHOUT ROWID;

-- Today's random salt for rate-limit keys (a hash of salt and IP that is never stored).
-- Rows of past days are deleted, so yesterday's keys cannot be recomputed.
CREATE TABLE salts (
  day TEXT PRIMARY KEY,
  salt TEXT NOT NULL
);
