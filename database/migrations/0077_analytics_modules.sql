CREATE TABLE IF NOT EXISTS analytics_modules (
  day date NOT NULL, visitor_key text NOT NULL, module text NOT NULL,
  pv integer NOT NULL DEFAULT 1 CHECK (pv > 0), PRIMARY KEY (day, visitor_key, module),
  FOREIGN KEY (day, visitor_key) REFERENCES analytics_days(day, visitor_key)
);
