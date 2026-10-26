CREATE TABLE IF NOT EXISTS radar_requests (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
  host text NOT NULL, path text NOT NULL, status integer, error text, finished_at timestamptz,
  retry_at timestamptz
);
