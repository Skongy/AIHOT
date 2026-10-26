CREATE TABLE IF NOT EXISTS radar_samples (
  appid bigint NOT NULL REFERENCES radar_games(appid), observed_at timestamptz NOT NULL,
  count integer NOT NULL CHECK (count >= 0), rank integer, source text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (appid, observed_at, source)
);
