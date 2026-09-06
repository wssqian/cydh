import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { SessionStore } from './session-store';

export const DEFAULT_ADMIN_PASSWORD = 'WSSqian：';
const SESSION_COOKIE_NAME = 'ciyuan_admin_session';
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
// 会话表持久化到 data/admin-sessions.json，进程重启不丢失
const sessions = new SessionStore({ fileName: 'admin-sessions.json' });

function configuredPassword() {
  return process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
}

export function assertSecureAdminConfiguration() {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const password = process.env.ADMIN_PASSWORD;
  if (!password || password === DEFAULT_ADMIN_PASSWORD) {
    throw new Error('Production requires ADMIN_PASSWORD and refuses the bundled default password.');
  }
  if (password.length < 8) {
    throw new Error('Production ADMIN_PASSWORD must be at least 8 characters long.');
  }
}

export function shouldSetSecureAdminCookie() {
  if (process.env.ADMIN_COOKIE_SECURE === 'false') {
    return false;
  }
  return process.env.ADMIN_COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
}

function constantTimeEquals(submitted: string, expected: string) {
  const submittedValue = Buffer.from(submitted);
  const expectedValue = Buffer.from(expected);
  return submittedValue.length === expectedValue.length
    && timingSafeEqual(submittedValue, expectedValue);
}

function readCookie(request: Request, name: string) {
  const cookies = request.headers.cookie?.split(';') || [];
  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split('=');
    if (key === name) {
      return decodeURIComponent(value.join('='));
    }
  }
  return undefined;
}

function clearExpiredSessions() {
  sessions.clearExpired();
}

export function createAdminSession(password: string) {
  if (!constantTimeEquals(password, configuredPassword())) {
    return undefined;
  }

  clearExpiredSessions();
  const token = randomBytes(32).toString('base64url');
  sessions.set(token, Date.now() + SESSION_MAX_AGE_MS);
  return token;
}

export function isValidAdminSession(token: string | undefined) {
  if (!token) {
    return false;
  }

  clearExpiredSessions();
  const expiresAt = sessions.get(token);
  return expiresAt !== undefined && expiresAt > Date.now();
}

export function revokeAdminSession(token: string | undefined) {
  if (token) {
    sessions.delete(token);
  }
}

export function getAdminSessionToken(request: Request) {
  return readCookie(request, SESSION_COOKIE_NAME);
}

export function setAdminSessionCookie(response: Response, token: string) {
  const secure = shouldSetSecureAdminCookie() ? '; Secure' : '';
  response.append(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_MS / 1000}${secure}`,
  );
}

export function clearAdminSessionCookie(response: Response) {
  const secure = shouldSetSecureAdminCookie() ? '; Secure' : '';
  response.append(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
  );
}

export function requireAdminSession(request: Request, response: Response, next: NextFunction) {
  if (!isValidAdminSession(getAdminSessionToken(request))) {
    response.status(401).json({ error: '需要管理员登录。' });
    return;
  }
  next();
}
