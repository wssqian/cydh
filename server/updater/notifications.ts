/**
 * 通知发送模块
 */

import type { UpdaterSettings, NotificationPayload } from './types.js';
import { createHmac } from 'node:crypto';
import { sendEmail } from '../mailer.js';

interface WebhookConfig {
  url: string;
  secret?: string;
}

function generateHmacSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

async function sendWebhook(config: WebhookConfig, payload: NotificationPayload): Promise<boolean> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'guga-updater',
  };
  
  if (config.secret) {
    headers['X-Updater-Signature'] = generateHmacSignature(body, config.secret);
  }
  
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(config.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });
      
      if (response.ok) {
        return true;
      }
      
      console.error(`[Updater] Webhook 发送失败 (尝试 ${attempt}/${maxRetries}): ${response.status} ${response.statusText}`);
    } catch (error: any) {
      console.error(`[Updater] Webhook 发送异常 (尝试 ${attempt}/${maxRetries}): ${error.message}`);
    }
    
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, 1000 * attempt)); // 指数退避
    }
  }
  
  return false;
}

function formatNotificationMessage(payload: NotificationPayload): { subject: string; text: string } {
  const timestamp = new Date(payload.timestamp).toLocaleString('zh-CN');
  const eventLabels: Record<string, string> = {
    update_available: '发现新版本',
    update_started: '更新开始',
    update_succeeded: '更新成功',
    update_failed: '更新失败',
    rollback_triggered: '触发回滚',
    health_check_failed: '健康检查失败',
  };
  
  const eventLabel = eventLabels[payload.event] || payload.event;
  const subject = `[次元导航] ${eventLabel} - ${payload.version?.current || '未知版本'}`;
  
  let text = `次元导航更新系统通知\n\n`;
  text += `事件: ${eventLabel}\n`;
  text += `时间: ${timestamp}\n`;
  text += `通道: ${payload.channel}\n`;
  
  if (payload.method) {
    text += `方式: ${payload.method === 'source' ? '源码更新' : '发布包更新'}\n`;
  }
  
  if (payload.version) {
    text += `版本: ${payload.version.previous} → ${payload.version.current}\n`;
  }
  
  if (payload.jobId) {
    text += `任务 ID: ${payload.jobId}\n`;
  }
  
  if (payload.error) {
    text += `错误: ${payload.error}\n`;
  }
  
  if (payload.details) {
    text += `详情: ${JSON.stringify(payload.details, null, 2)}\n`;
  }
  
  return { subject, text };
}

export async function sendUpdateNotification(
  settings: UpdaterSettings,
  payload: NotificationPayload
): Promise<{ console: boolean; email: boolean; webhook: boolean }> {
  const results = { console: false, email: false, webhook: false };
  
  // 1. 控制台日志（始终发送）
  console.log('[Updater Notification]', JSON.stringify(payload));
  results.console = true;
  
  // 2. 邮件通知
  if (settings.notifications.email_enabled && settings.notifications.email_recipients.length > 0) {
    try {
      const { subject, text } = formatNotificationMessage(payload);
      const emailResult = await sendEmail(
        settings.notifications.email_recipients.join(','),
        subject,
        text
      );
      results.email = emailResult.success;
      if (!emailResult.success) {
        console.error('[Updater] 邮件发送失败:', emailResult.error);
      }
    } catch (error: any) {
      console.error('[Updater] 邮件发送异常:', error.message);
    }
  }
  
  // 3. Webhook 通知
  if (settings.notifications.webhook_url) {
    const webhookConfig: WebhookConfig = {
      url: settings.notifications.webhook_url,
      secret: settings.notifications.webhook_secret || undefined,
    };
    results.webhook = await sendWebhook(webhookConfig, payload);
  }
  
  return results;
}

export async function sendTestNotification(settings: UpdaterSettings): Promise<{ console: boolean; email: boolean; webhook: boolean }> {
  const payload: NotificationPayload = {
    event: 'test',
    timestamp: new Date().toISOString(),
    channel: settings.channel,
    details: { message: '这是一条测试通知，用于验证通知渠道配置是否正确。' },
  };
  
  return sendUpdateNotification(settings, payload);
}