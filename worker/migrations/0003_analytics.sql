-- Anonymous usage statistics. No IP addresses, no text, nothing stored on
-- the visitor's device. `visitor` is a hash of the day's random salt, the IP (an IPv6
-- address's /64) and the User-Agent: once the salt is deleted after its day, it can no
-- longer be linked to an address or to the same visitor on another day. Visits and events
-- are kept for 400 days (daily cron); `daily` keeps per-day totals after that.

-- One row per page view. `id` is a random ID that lived only in the page's memory.
CREATE TABLE visits (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,            -- YYYY-MM-DD (UTC)
  started_at INTEGER NOT NULL,  -- Unix time in ms (server clock), whole minutes
  last_seen INTEGER NOT NULL,   -- last request of the visit, Unix ms, whole minutes
  visitor TEXT NOT NULL,        -- the day's visitor hash (see above)
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  as_org TEXT NOT NULL DEFAULT '', -- the network's operator (e.g. a university or an ISP)
  suspect INTEGER NOT NULL DEFAULT 0, -- 1: from a cloud or hosting network (maybe a bot)
  device TEXT NOT NULL DEFAULT '',   -- desktop | mobile | tablet
  browser TEXT NOT NULL DEFAULT '',  -- family only, never the User-Agent itself
  os TEXT NOT NULL DEFAULT '',
  lang TEXT NOT NULL DEFAULT '',
  ref_host TEXT NOT NULL DEFAULT '', -- the referring site's hostname only
  utm_source TEXT NOT NULL DEFAULT '',
  utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL DEFAULT '',
  viewport TEXT NOT NULL DEFAULT '',
  theme TEXT NOT NULL DEFAULT '',
  touch INTEGER NOT NULL DEFAULT 0,
  active_s INTEGER NOT NULL DEFAULT 0, -- seconds the page was visible
  scroll_max INTEGER NOT NULL DEFAULT 0 -- deepest scroll position, percent
);
-- No index on last_seen: it changes with every request, and each index costs a row write.
CREATE INDEX visits_day ON visits (day);

-- What happened during a visit: fixed event names and values, entry IDs or buckets.
CREATE TABLE events (
  visit TEXT NOT NULL,
  t_ms INTEGER NOT NULL,        -- ms after the page was opened
  name TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT ''
);
CREATE INDEX events_visit ON events (visit);

-- Per-day totals, written by the daily cron for the day before (kept after visits go).
CREATE TABLE daily (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,         -- e.g. 'visits', 'visitors', 'country', 'event:popover'
  value TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL,
  PRIMARY KEY (day, metric, value)
) WITHOUT ROWID;
-- The dashboard's long view reads a few metrics over all days.
CREATE INDEX daily_metric ON daily (metric, day);
