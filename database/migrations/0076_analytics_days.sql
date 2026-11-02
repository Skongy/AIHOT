CREATE TABLE IF NOT EXISTS analytics_days (
  day date NOT NULL, visitor_key text NOT NULL REFERENCES analytics_visitors(visitor_key),
  pv integer NOT NULL DEFAULT 1 CHECK (pv > 0), source text NOT NULL CHECK (length(source) <= 256),
  device text NOT NULL CHECK (device IN ('PC','移动端','其他')),
  PRIMARY KEY (day, visitor_key)
);
