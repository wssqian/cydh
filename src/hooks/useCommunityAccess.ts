import { useCallback, useEffect, useState } from "react";

/**
 * 社区访问会话——前端以服务端 judgement 为准（server/community-auth.ts）。
 *
 * 口令不再前端持有：unlock 调 POST /api/public/community/unlock，由服务端
 * 常量时间比对并签发 HttpOnly cookie。localStorage 不参与访问控制判断，
 * 仅 MAY 缓存上次探查结果以减少首屏闪烁（最终仍以服务端 session 为准）。
 */

const OPTIMISTIC_KEY = "communityUnlocked";

type UseCommunityAccessResult = {
  /** 是否已通过服务端校验（社区会话有效） */
  unlocked: boolean;
  /** 首次探查服务端前的 loading 态 */
  checking: boolean;
  /** 提交口令解锁；成功 true、失败 false */
  unlock: (password: string) => Promise<boolean>;
  /** 登出当前社区会话 */
  logout: () => Promise<void>;
  /** 手动标记为已锁定（例如内容请求 401 后回退门禁） */
  markLocked: () => void;
};

export function useCommunityAccess(): UseCommunityAccessResult {
  const [unlocked, setUnlocked] = useState<boolean>(
    () => localStorage.getItem(OPTIMISTIC_KEY) === "true",
  );
  const [checking, setChecking] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetch("/api/public/community/session", { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { unlocked: false }))
      .then((data: { unlocked?: boolean }) => {
        if (cancelled) return;
        const next = Boolean(data.unlocked);
        setUnlocked(next);
        setChecking(false);
        if (next) localStorage.setItem(OPTIMISTIC_KEY, "true");
        else localStorage.removeItem(OPTIMISTIC_KEY);
      })
      .catch((err: unknown) => {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        setUnlocked(false);
        setChecking(false);
        localStorage.removeItem(OPTIMISTIC_KEY);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const unlock = useCallback(async (password: string) => {
    try {
      const res = await fetch("/api/public/community/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setUnlocked(true);
        localStorage.setItem(OPTIMISTIC_KEY, "true");
        return true;
      }
      setUnlocked(false);
      localStorage.removeItem(OPTIMISTIC_KEY);
      return false;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/public/community/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    setUnlocked(false);
    localStorage.removeItem(OPTIMISTIC_KEY);
  }, []);

  const markLocked = useCallback(() => {
    setUnlocked(false);
    localStorage.removeItem(OPTIMISTIC_KEY);
  }, []);

  return { unlocked, checking, unlock, logout, markLocked };
}
