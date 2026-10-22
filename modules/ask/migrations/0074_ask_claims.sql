CREATE TABLE IF NOT EXISTS ask_claims (
  task_id uuid NOT NULL REFERENCES ask_tasks(id) ON DELETE CASCADE,
  claim_index integer NOT NULL,
  text text NOT NULL,
  status text NOT NULL,
  kind text NOT NULL,
  evidence_ids integer[] NOT NULL DEFAULT '{}',
  quote text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, claim_index),
  CONSTRAINT ask_claims_status_check CHECK (status IN ('supported', 'insufficient', 'disputed', 'contradicted', 'withdrawn')),
  CONSTRAINT ask_claims_kind_check CHECK (kind IN ('fact', 'inference'))
);
