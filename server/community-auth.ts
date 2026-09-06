import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { SessionStore } from './session-store';

/**
 * 社区访问会话（community access session）
 *
 * 保护 /pixiv、/bangumi、/manga、/galgame 四个板块及其背后的 ACG 公开端点。
 * 与 administrator 会话（server/admin-auth.ts）完全隔离：
 *  - 独立 cookie 名 / 独立 path
 *  - 独立会话表（各自 data/*.json 文件）
 *  - 独立签发 / 校验 / 登出逻辑
 *  - 独立口令来源（COMMUNITY_PASSWORD）与独立启动安全校验
 *
 * 口令永不写入前端源码 / 构建产物 / localStorage / 日志；前端只发起一次 unlock，
 * 由服务端常量时间比对并签发 cookie。
 *
 * 会话表持久化到 data/community-sessions.json（见 session-store.ts），
 * 进程重启不丢失，修复"输入口令后时不时失效"问题。
 */

export const DEFAULT_COMMUNITY_PASSWORD = 'gugugaga';
const SESSION_COOKIE_NAME = 'ciyuan_community_session';
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const sessions = new SessionStore({ fileName: 'community-sessions.json' });

function configuredPassword() {
  return process.env.COMMUNITY_PASSWORD || DEFAULT_COMMUNITY_PASSWORD;
}

export function assertSecureCommunityConfiguration() {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const password = process.env.COMMUNITY_PASSWORD;
  if (!password || password === DEFAULT_COMMUNITY_PASSWORD) {
    throw new Error('Production requires COMMUNITY_PASSWORD and refuses the bundled default password.');
  }
  if (password.length < 8) {
    throw new Error('Production COMMUNITY_PASSWORD must be at least 8 characters long.');
  }
}

export function shouldSetSecureCommunityCookie() {
  if (process.env.COMMUNITY_COOKIE_SECURE === 'false') {
    return false;
  }
  return process.env.COMMUNITY_COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
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

export function createCommunitySession(password: string) {
  if (!constantTimeEquals(password, configuredPassword())) {
    return undefined;
  }

  clearExpiredSessions();
  const token = randomBytes(32).toString('base64url');
  sessions.set(token, Date.now() + SESSION_MAX_AGE_MS);
  return token;
}

export function isValidCommunitySession(token: string | undefined) {
  if (!token) {
    return false;
  }

  clearExpiredSessions();
  const expiresAt = sessions.get(token);
  if (expiresAt === undefined) {
    return false;
  }
  if (expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function revokeCommunitySession(token: string | undefined) {
  if (token) {
    sessions.delete(token);
  }
}

export function getCommunitySessionToken(request: Request) {
  return readCookie(request, SESSION_COOKIE_NAME);
}

export function setCommunitySessionCookie(response: Response, token: string) {
  const secure = shouldSetSecureCommunityCookie() ? '; Secure' : '';
  // Path=/ 需覆盖 /api/public/* 与前端首次探查（同源 fetch 会自动带 cookie）
  response.append(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_MS / 1000}${secure}`,
  );
}

export function clearCommunitySessionCookie(response: Response) {
  const secure = shouldSetSecureCommunityCookie() ? '; Secure' : '';
  response.append(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
  );
}

export function requireCommunitySession(request: Request, response: Response, next: NextFunction) {
  if (!isValidCommunitySession(getCommunitySessionToken(request))) {
    response.status(401).json({ error: '需要社区访问口令。' });
    return;
  }
  next();
}
