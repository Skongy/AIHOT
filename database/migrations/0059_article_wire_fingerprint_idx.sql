CREATE INDEX CONCURRENTLY IF NOT EXISTS articles_wire_fingerprint_idx
  ON articles (wire_fingerprint)
  WHERE wire_fingerprint IS NOT NULL;
