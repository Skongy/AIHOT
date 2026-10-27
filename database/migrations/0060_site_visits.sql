CREATE TABLE IF NOT EXISTS site_visits (
  id bigserial PRIMARY KEY,
  visited_at timestamptz NOT NULL DEFAULT now(),
  ip inet NOT NULL,
  path text NOT NULL CHECK (length(path) <= 512),
  referrer_origin text,
  user_agent text NOT NULL CHECK (length(user_agent) <= 512)
);
