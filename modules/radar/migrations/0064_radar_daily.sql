CREATE TABLE IF NOT EXISTS radar_daily (
  appid bigint NOT NULL REFERENCES radar_games(appid), day date NOT NULL,
  peak integer NOT NULL, samples integer NOT NULL, hours integer NOT NULL,
  PRIMARY KEY (appid, day)
);
