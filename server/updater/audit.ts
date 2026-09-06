/**
 * 审计日志模块
 */

import type Database from 'better-sqlite3';
import type { AuditLogEntry, AuditLogQuery, AuditLogResponse, AuditEvent, UpdateMethod, UpdateChannel } from './types.js';

const INSERT_STMT = `
  INSERT INTO updater_audit_log (timestamp, event, method, channel, previous_version, target_version, actual_version, duration_ms, success, error_message, metadata, triggered_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const SELECT_BASE = `
  SELECT id, timestamp, event, method, channel, previous_version, target_version, actual_version, duration_ms, success, error_message, metadata, triggered_by
  FROM updater_audit_log
`;

type AuditRow = {
  id: number;
  timestamp: string;
  event: string;
  method: string | null;
  channel: string | null;
  previous_version: string | null;
  target_version: string | null;
  actual_version: string | null;
  duration_ms: number | null;
  success: number;
  error_message: string | null;
  metadata: string | null;
  triggered_by: string;
};

export function recordAudit(
  database: Database.Database,
  entry: Omit<AuditLogEntry, 'id'>
): number {
  const stmt = database.prepare(INSERT_STMT);
  const info = stmt.run(
    entry.timestamp,
    entry.event,
    entry.method || null,
    entry.channel || null,
    entry.previousVersion || null,
    entry.targetVersion || null,
    entry.actualVersion || null,
    entry.durationMs || null,
    entry.success ? 1 : 0,
    entry.errorMessage || null,
    entry.metadata || null,
    entry.triggeredBy
  );
  return info.lastInsertRowid as number;
}

export function queryAuditLog(
  database: Database.Database,
  query: AuditLogQuery = {}
): AuditLogResponse {
  const page = query.page || 1;
  const pageSize = Math.min(query.pageSize || 50, 200);
  const offset = (page - 1) * pageSize;
  
  const conditions: string[] = [];
  const params: unknown[] = [];
  
  if (query.event) {
    conditions.push('event = ?');
    params.push(query.event);
  }
  if (query.channel) {
    conditions.push('channel = ?');
    params.push(query.channel);
  }
  if (query.method) {
    conditions.push('method = ?');
    params.push(query.method);
  }
  if (query.from) {
    conditions.push('timestamp >= ?');
    params.push(query.from);
  }
  if (query.to) {
    conditions.push('timestamp <= ?');
    params.push(query.to);
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const countStmt = database.prepare(`SELECT COUNT(*) as count FROM updater_audit_log ${whereClause}`);
  const totalCount = (countStmt.get(...params) as { count: number }).count;
  
  const selectStmt = database.prepare(
    `${SELECT_BASE} ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
  );
  const rows = selectStmt.all(...params, pageSize, offset) as AuditRow[];
  
  const entries: AuditLogEntry[] = rows.map(r => ({
    id: r.id,
    timestamp: r.timestamp,
    event: r.event as AuditEvent,
    method: r.method as UpdateMethod | undefined,
    channel: r.channel as UpdateChannel | undefined,
    previousVersion: r.previous_version || undefined,
    targetVersion: r.target_version || undefined,
    actualVersion: r.actual_version || undefined,
    durationMs: r.duration_ms || undefined,
    success: r.success === 1,
    errorMessage: r.error_message || undefined,
    metadata: r.metadata || undefined,
    triggeredBy: r.triggered_by as 'manual' | 'auto' | 'scheduled',
  }));
  
  return {
    entries,
    totalCount,
    page,
    pageSize,
  };
}

export function getAuditLogStats(database: Database.Database): {
  totalEvents: number;
  eventsByType: Record<string, number>;
  eventsByChannel: Record<string, number>;
  successRate: number;
  lastEvent: AuditLogEntry | null;
} {
  const totalStmt = database.prepare('SELECT COUNT(*) as count FROM updater_audit_log');
  const totalEvents = (totalStmt.get() as { count: number }).count;
  
  const byTypeStmt = database.prepare('SELECT event, COUNT(*) as count FROM updater_audit_log GROUP BY event');
  const byTypeRows = byTypeStmt.all() as Array<{ event: string; count: number }>;
  const eventsByType: Record<string, number> = {};
  for (const row of byTypeRows) {
    eventsByType[row.event] = row.count;
  }
  
  const byChannelStmt = database.prepare('SELECT channel, COUNT(*) as count FROM updater_audit_log WHERE channel IS NOT NULL GROUP BY channel');
  const byChannelRows = byChannelStmt.all() as Array<{ channel: string; count: number }>;
  const eventsByChannel: Record<string, number> = {};
  for (const row of byChannelRows) {
    eventsByChannel[row.channel] = row.count;
  }
  
  const successStmt = database.prepare('SELECT COUNT(*) as count FROM updater_audit_log WHERE success = 1');
  const successCount = (successStmt.get() as { count: number }).count;
  const successRate = totalEvents > 0 ? successCount / totalEvents : 0;
  
  const lastStmt = database.prepare(`${SELECT_BASE} ORDER BY timestamp DESC LIMIT 1`);
  const lastRow = lastStmt.get() as AuditRow | undefined;
  const lastEvent = lastRow ? {
    id: lastRow.id,
    timestamp: lastRow.timestamp,
    event: lastRow.event as AuditEvent,
    method: lastRow.method as UpdateMethod | undefined,
    channel: lastRow.channel as UpdateChannel | undefined,
    previousVersion: lastRow.previous_version || undefined,
    targetVersion: lastRow.target_version || undefined,
    actualVersion: lastRow.actual_version || undefined,
    durationMs: lastRow.duration_ms || undefined,
    success: lastRow.success === 1,
    errorMessage: lastRow.error_message || undefined,
    metadata: lastRow.metadata || undefined,
    triggeredBy: lastRow.triggered_by as 'manual' | 'auto' | 'scheduled',
  } : null;
  
  return {
    totalEvents,
    eventsByType,
    eventsByChannel,
    successRate,
    lastEvent,
  };
}

export function cleanupOldAuditLogs(database: Database.Database, maxEntries: number = 10000): number {
  const deleteStmt = database.prepare(`
    DELETE FROM updater_audit_log
    WHERE id NOT IN (
      SELECT id FROM updater_audit_log ORDER BY timestamp DESC LIMIT ?
    )
  `);
  const info = deleteStmt.run(maxEntries);
  return info.changes;
}