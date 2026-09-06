-- Migration 001: Create updater audit log table
CREATE TABLE IF NOT EXISTS updater_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  event TEXT NOT NULL,
  method TEXT,
  channel TEXT,
  previous_version TEXT,
  target_version TEXT,
  actual_version TEXT,
  duration_ms INTEGER,
  success INTEGER NOT NULL,
  error_message TEXT,
  metadata TEXT,
  triggered_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_updater_audit_timestamp ON updater_audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_updater_audit_event ON updater_audit_log(event);
CREATE INDEX IF NOT EXISTS idx_updater_audit_channel ON updater_audit_log(channel);
CREATE INDEX IF NOT EXISTS idx_updater_audit_method ON updater_audit_log(method);