CREATE INDEX CONCURRENTLY IF NOT EXISTS site_visits_ip_time_idx ON site_visits (ip, visited_at DESC, id DESC);
