-- The API also creates this table on first request; running it manually is optional.
CREATE TABLE IF NOT EXISTS items (
  kind       TEXT    NOT NULL,
  id         TEXT    NOT NULL,
  data       TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (kind, id)
);
