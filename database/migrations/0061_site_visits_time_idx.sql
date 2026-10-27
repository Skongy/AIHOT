CREATE INDEX CONCURRENTLY IF NOT EXISTS site_visits_time_idx ON site_visits (visited_at DESC, id DESC);
