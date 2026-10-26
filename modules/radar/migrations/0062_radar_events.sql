CREATE TABLE IF NOT EXISTS radar_events (
  id text PRIMARY KEY, appid bigint NOT NULL REFERENCES radar_games(appid), event_day date NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(), origin text NOT NULL CHECK (origin IN ('historical','live')),
  status text NOT NULL CHECK (status IN ('confirmed','suspected')), kind text NOT NULL,
  peak integer NOT NULL, baseline double precision, baseline_days integer NOT NULL,
  points jsonb NOT NULL, rule_version text NOT NULL, proof jsonb NOT NULL,
  reason text, evidence jsonb NOT NULL DEFAULT '[]', analyzed_at timestamptz,
  UNIQUE (appid, event_day)
);
