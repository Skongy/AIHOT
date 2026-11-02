CREATE TABLE IF NOT EXISTS analytics_visitors (
  visitor_key text PRIMARY KEY CHECK (length(visitor_key) = 64),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
