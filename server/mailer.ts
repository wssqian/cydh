/**
 * mailer.ts — 基于 Resend API 的邮件发送模块
 *
 * 配置项从 settings DB 表或环境变量读取。
 * 使用 Resend REST API，无需 SMTP 依赖。
 * 文档: https://resend.com/docs/api-reference/emails/send-email
 */

import db from './db';

/* ------------------------------------------------------------------ */
/*  Settings keys                                                      */
/* ------------------------------------------------------------------ */

export const EMAIL_SETTING_KEYS = [
  'email_resend_api_key',
  'email_from_addr',
  'email_from_name',
  'email_notify_on_submission',
  'email_notify_on_error',
  'email_admin_recipients',
] as const;

export type EmailSettings = {
  resend_api_key: string;
  from_addr: string;
  from_name: string;
  notify_on_submission: boolean;
  notify_on_error: boolean;
  admin_recipients: string[]; // comma-separated in DB
};

const DEFAULTS: EmailSettings = {
  resend_api_key: '',
  from_addr: '',
  from_name: '次元导航',
  notify_on_submission: true,
  notify_on_error: false,
  admin_recipients: [],
};

const RESEND_API_URL = 'https://api.resend.com/emails';

/* ------------------------------------------------------------------ */
/*  Read / write settings                                              */
/* ------------------------------------------------------------------ */

function readRaw(key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? '';
}

export function readEmailSettings(): EmailSettings {
  const raw: Record<string, string> = {};
  for (const k of EMAIL_SETTING_KEYS) {
    raw[k] = readRaw(k);
  }

  const env = process.env;

  return {
    resend_api_key: raw.email_resend_api_key || env.RESEND_API_KEY || DEFAULTS.resend_api_key,
    from_addr: raw.email_from_addr || env.EMAIL_FROM_ADDR || DEFAULTS.from_addr,
    from_name: raw.email_from_name || env.EMAIL_FROM_NAME || DEFAULTS.from_name,
    notify_on_submission: raw.email_notify_on_submission === 'true',
    notify_on_error: raw.email_notify_on_error === 'true',
    admin_recipients: (raw.email_admin_recipients || env.EMAIL_ADMIN_RECIPIENTS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  };
}

export function saveEmailSettings(partial: Partial<EmailSettings>): void {
  const map: Record<string, string> = {};
  if (partial.resend_api_key !== undefined) map.email_resend_api_key = partial.resend_api_key;
  if (partial.from_addr !== undefined) map.email_from_addr = partial.from_addr;
  if (partial.from_name !== undefined) map.email_from_name = partial.from_name;
  if (partial.notify_on_submission !== undefined) map.email_notify_on_submission = partial.notify_on_submission ? 'true' : 'false';
  if (partial.notify_on_error !== undefined) map.email_notify_on_error = partial.notify_on_error ? 'true' : 'false';
  if (partial.admin_recipients !== undefined) map.email_admin_recipients = partial.admin_recipients.join(',');

  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [key, value] of Object.entries(map)) {
    stmt.run(key, value);
  }
}

/* ------------------------------------------------------------------ */
/*  Resend API client                                                  */
/* ------------------------------------------------------------------ */

/**
 * 通过 Resend API 发送单封邮件。
 * 可传入 override 临时覆盖 DB 中的设置（用于未保存时测试）。
 * 返回 { success, error? }
 */
export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  override?: { resend_api_key?: string; from_addr?: string; from_name?: string },
): Promise<{ success: boolean; error?: string }> {
  const settings = readEmailSettings();

  const apiKey = override?.resend_api_key || settings.resend_api_key;
  const fromAddr = override?.from_addr || settings.from_addr;
  const fromName = override?.from_name || settings.from_name;

  if (!apiKey) {
    return { success: false, error: '请先配置 Resend API Key' };
  }
  if (!fromAddr) {
    return { success: false, error: '请先配置发件人地址' };
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromName
          ? `${fromName} <${fromAddr}>`
          : fromAddr,
        to: [to],
        subject,
        text,
      }),
    });

    if (!response.ok) {
      let errorMsg = `Resend API error (${response.status})`;
      try {
        const err = await response.json() as { message?: string };
        if (err.message) errorMsg = `Resend: ${err.message}`;
      } catch { /* ignore */ }
      return { success: false, error: errorMsg };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error' };
  }
}

/**
 * 发送新提交通知给所有管理员配置的邮箱。
 */
export async function notifyNewSubmission(submission: {
  type: 'suggestion' | 'url';
  content: string;
  contact?: string;
}): Promise<void> {
  const settings = readEmailSettings();
  if (!settings.notify_on_submission || settings.admin_recipients.length === 0) return;

  const subject = submission.type === 'url'
    ? `[次元导航] 新网址提交: ${submission.content.slice(0, 80)}`
    : `[次元导航] 新建议反馈`;

  const text = [
    `类型: ${submission.type === 'url' ? '网址提交' : '建议反馈'}`,
    `内容: ${submission.content}`,
    submission.contact ? `联系方式: ${submission.contact}` : '',
    `时间: ${new Date().toLocaleString('zh-CN')}`,
    '',
    '---',
    '此邮件由次元导航系统自动发送',
  ].filter(Boolean).join('\n');

  for (const recipient of settings.admin_recipients) {
    const result = await sendEmail(recipient, subject, text);
    if (!result.success) {
      const { createLogger } = await import('./logger');
      const log = createLogger('Mailer');
      log.error('Failed to send notification to', recipient, result.error);
    }
  }
}
