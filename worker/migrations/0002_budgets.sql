-- Per-day write budgets, no client data. 'hits' counts the hit rows written on the day, so
-- that no client can use up the account's daily D1 write quota (shared with the account's
-- other projects).
CREATE TABLE budgets (
  day TEXT NOT NULL,       -- YYYY-MM-DD (UTC)
  name TEXT NOT NULL,
  used INTEGER NOT NULL,
  PRIMARY KEY (day, name)
) WITHOUT ROWID;
