/**
 * submission.ts — 用户提交建议/网址的管理模块
 *
 * 在 SQLite 中创建 `submissions` 表存储用户提交的内容。
 * 提供 CRUD API 供管理员查看和管理。
 */

import db from './db';
import { notifyNewSubmission } from './mailer';

/* ------------------------------------------------------------------ */
/*  Schema                                                             */
/* ------------------------------------------------------------------ */

export function ensureSubmissionTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('suggestion', 'url')),
      content TEXT NOT NULL,
      contact TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'read', 'resolved', 'rejected')),
      admin_note TEXT DEFAULT '',
      ip_hash TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface Submission {
  id: number;
  type: 'suggestion' | 'url';
  content: string;
  contact: string;
  status: 'pending' | 'read' | 'resolved' | 'rejected';
  admin_note: string;
  ip_hash: string;
  created_at: string;
  updated_at: string;
}

export interface CreateSubmissionInput {
  type: 'suggestion' | 'url';
  content: string;
  contact?: string;
  ip?: string;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * 创建一条新的用户提交。
 * 如果邮箱已配置通知，会异步发送邮件通知管理员。
 */
export function createSubmission(input: CreateSubmissionInput): Submission {
  const { type, content, contact, ip } = input;

  if (!content || content.trim().length === 0) {
    throw new Error('内容不能为空');
  }
  if (content.length > 2000) {
    throw new Error('内容不能超过2000个字符');
  }
  if (contact && contact.length > 200) {
    throw new Error('联系方式不能超过200个字符');
  }
  if (!['suggestion', 'url'].includes(type)) {
    throw new Error('无效的提交类型');
  }

  const ipHash = ip
    ? require('node:crypto').createHash('sha256').update(ip).digest('hex').slice(0, 16)
    : '';

  const stmt = db.prepare(`
    INSERT INTO submissions (type, content, contact, ip_hash, status)
    VALUES (?, ?, ?, ?, 'pending')
  `);

  const result = stmt.run(type, content.trim(), (contact || '').trim(), ipHash);

  const submission: Submission = {
    id: result.lastInsertRowid as number,
    type,
    content: content.trim(),
    contact: (contact || '').trim(),
    status: 'pending',
    admin_note: '',
    ip_hash: ipHash,
    created_at: new Date().toLocaleString('zh-CN'),
    updated_at: new Date().toLocaleString('zh-CN'),
  };

  // 异步发送邮件通知
  notifyNewSubmission(submission).catch(() => {
    // 静默失败，不影响用户
  });

  return submission;
}

/**
 * 更新提交状态。
 */
export function updateSubmissionStatus(
  id: number,
  status: Submission['status'],
  adminNote?: string,
): Submission {
  const existing = db.prepare('SELECT * FROM submissions WHERE id = ?').get(id) as Submission | undefined;
  if (!existing) {
    throw new Error('提交记录不存在');
  }

  const now = new Date().toLocaleString('zh-CN');
  const note = adminNote !== undefined ? adminNote : existing.admin_note;

  db.prepare(`
    UPDATE submissions SET status = ?, admin_note = ?, updated_at = ? WHERE id = ?
  `).run(status, note, now, id);

  return { ...existing, status, admin_note: note, updated_at: now };
}

/**
 * 获取提交列表（分页）。
 */
export function listSubmissions(options: {
  status?: string;
  type?: string;
  page?: number;
  pageSize?: number;
}): { items: Submission[]; total: number; page: number; pageSize: number } {
  const { status, type, page = 1, pageSize = 20 } = options;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (status && status !== 'all') {
    conditions.push('status = ?');
    params.push(status);
  }
  if (type && type !== 'all') {
    conditions.push('type = ?');
    params.push(type);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const total = (db.prepare(`SELECT COUNT(*) as count FROM submissions ${where}`).get(...params) as { count: number }).count;
  const items = db.prepare(
    `SELECT * FROM submissions ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, pageSize, offset) as Submission[];

  return { items, total, page, pageSize };
}

/**
 * 删除提交。
 */
export function deleteSubmission(id: number): void {
  const existing = db.prepare('SELECT id FROM submissions WHERE id = ?').get(id);
  if (!existing) {
    throw new Error('提交记录不存在');
  }
  db.prepare('DELETE FROM submissions WHERE id = ?').run(id);
}

/**
 * 获取未读提交数量。
 */
export function getUnreadCount(): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM submissions WHERE status = 'pending'").get() as { count: number };
  return row.count;
}
