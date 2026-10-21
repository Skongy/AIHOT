ALTER TABLE ask_tasks ADD CONSTRAINT ask_tasks_mode_check CHECK (mode IN ('normal', 'deep')) NOT VALID;
