-- Migration 003: Create updater job state table for persistence
CREATE TABLE IF NOT EXISTS updater_job_state (
  id TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  state TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  result TEXT,
  error TEXT,
  log TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_updater_job_state_updated ON updater_job_state(updated_at);