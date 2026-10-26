CREATE TABLE IF NOT EXISTS radar_games (
  appid bigint PRIMARY KEY CHECK (appid > 0), name text NOT NULL, cover_url text,
  release_day date, established boolean NOT NULL DEFAULT false,
  origin text NOT NULL, first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_sample_at timestamptz, history_loaded_at timestamptz, metadata_at timestamptz,
  watch_until timestamptz NOT NULL DEFAULT now() + interval '14 days'
);
