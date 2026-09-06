-- Migration 002: Add updater settings keys
-- Default values for new updater settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('updater_channel', 'stable');
INSERT OR IGNORE INTO settings (key, value) VALUES ('updater_maintenance_window_start', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('updater_maintenance_window_end', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('updater_maintenance_window_timezone', 'Asia/Shanghai');
INSERT OR IGNORE INTO settings (key, value) VALUES ('updater_signature_public_key', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('updater_signature_allow_unsigned_dev', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('updater_notifications_email_enabled', 'false');
INSERT OR IGNORE INTO settings (key, value) VALUES ('updater_notifications_email_recipients', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('updater_notifications_webhook_url', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('updater_notifications_webhook_secret', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('updater_notifications_events', '["update_available","update_started","update_succeeded","update_failed","rollback_triggered","health_check_failed"]');