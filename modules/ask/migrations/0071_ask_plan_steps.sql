CREATE TABLE IF NOT EXISTS ask_plan_steps (
  task_id uuid NOT NULL REFERENCES ask_tasks(id) ON DELETE CASCADE,
  step_index integer NOT NULL,
  goal text NOT NULL,
  tool_hint text,
  depends_on integer[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',
  attempt integer NOT NULL DEFAULT 0,
  result_summary text,
  checkpoint jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, step_index),
  CONSTRAINT ask_plan_steps_status_check CHECK (status IN ('pending', 'running', 'done', 'skipped', 'failed'))
);
