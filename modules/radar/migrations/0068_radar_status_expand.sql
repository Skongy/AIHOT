ALTER TABLE radar_events ADD CONSTRAINT radar_events_lifecycle_check CHECK (status IN ('confirmed','suspected','surging','cooled')) NOT VALID;
