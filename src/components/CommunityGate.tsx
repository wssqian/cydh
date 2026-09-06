import { useState, type ReactNode } from "react";
import { Lock, Loader2 } from "lucide-react";

/**
 * 社区门禁——四个板块（/pixiv、/bangumi、/manga、/galgame）的门面。
 *
 * - checking：服务端 session 探查中，渲染骨架。
 * - unlocked：放行子节点。
 * - 未解锁：渲染口令输入框，提交调用 unlock；成功后父级 state 变 unlocked 放行子节点。
 *
 * 口令不前端比对：unlock 由父级 useCommunityAccess 调服务端端点判定。
 */
interface CommunityGateProps {
  /** 是否已通过服务端校验（来自 useCommunityAccess.unlocked） */
  unlocked: boolean;
  /** 首次探查服务端前的 loading 态 */
  checking: boolean;
  /** 提交口令解锁（来自 useCommunityAccess.unlock） */
  unlock: (password: string) => Promise<boolean>;
  /** 受限页面内容；仅 unlocked 时渲染 */
  children: ReactNode;
  /** 可选标题，默认"次元社区" */
  title?: string;
}

export function CommunityGate({ unlocked, checking, unlock, children, title = "次元社区" }: CommunityGateProps) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState("");

  if (checking) {
    return (
      <div className="liquid-panel mx-auto mt-12 max-w-md rounded-[2rem] px-8 py-14 text-center text-slate-400">
        <Loader2 className="mx-auto h-6 w-6 animate-spin" />
        <p className="mt-3 text-sm">正在验证访问权限…</p>
      </div>
    );
  }

  if (unlocked) {
    return <>{children}</>;
  }

  const submit = async () => {
    setSubmitting(true);
    setFeedback("");
    const value = code;
    const ok = await unlock(value);
    setSubmitting(false);
    setCode("");
    setFeedback(ok ? "已解锁，正在加载内容…" : "口令不正确，请重试。");
  };

  return (
    <div className="liquid-panel mx-auto mt-12 max-w-md rounded-[2rem] px-8 py-12 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-pink-100 text-pink-500 dark:bg-pink-900/30 dark:text-pink-300">
        <Lock className="h-6 w-6" />
      </div>
      <h2 className="text-lg font-bold text-slate-700 dark:text-slate-200">{title}已隐藏</h2>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        请输入访问口令后查看该板块内容。
      </p>
      <input
        type="password"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="输入口令后按回车"
        autoComplete="off"
        disabled={submitting}
        className="liquid-input mt-5 w-full rounded-2xl px-4 py-3 text-sm dark:text-slate-200"
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={submitting}
        className="liquid-button-primary mt-4 w-full px-5 py-2.5 text-sm font-medium disabled:opacity-60"
      >
        {submitting ? "验证中…" : "解锁"}
      </button>
      {feedback && (
        <p className={`mt-3 text-xs ${feedback.startsWith("已") ? "text-emerald-500" : "text-rose-500"}`}>{feedback}</p>
      )}
    </div>
  );
}

export default CommunityGate;
