import { useState, type FormEvent } from "react";
import { X, Send, Link2, MessageSquare, CheckCircle2, AlertCircle, Loader2, Mail, Edit3 } from "lucide-react";

interface SubmitSuggestionProps {
  onClose: () => void;
}

export default function SubmitSuggestion({ onClose }: SubmitSuggestionProps) {
  const [type, setType] = useState<"suggestion" | "url">("suggestion");
  const [content, setContent] = useState("");
  const [contact, setContact] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!content.trim()) {
      setError("请输入内容");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/public/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          content: content.trim(),
          contact: contact.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: "提交失败" }));
        throw new Error(data.error || "提交失败");
      }

      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "提交失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="liquid-overlay fixed inset-0 z-[100] flex items-center justify-center p-4">
        <div className="liquid-panel w-full max-w-sm rounded-[2rem] overflow-hidden animate-in fade-in zoom-in-95">
          <div className="p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-green-500 text-white shadow-lg animate-in zoom-in-95 duration-300">
              <div className="animate-in fade-in duration-500 delay-150">
                <CheckCircle2 className="h-8 w-8" />
              </div>
            </div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-2">
              感谢您的{type === "url" ? "网址提交" : "建议"}！
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
              我们已经收到您的{type === "url" ? "提交的网址" : "反馈建议"}，管理员会尽快查看处理。
            </p>
            <button
              onClick={onClose}
              className="liquid-button-primary px-6 py-2.5 font-medium text-sm hover:shadow-lg hover:shadow-emerald-500/20 transition-all"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="liquid-overlay fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="liquid-panel w-full max-w-md rounded-[2rem] overflow-hidden animate-in fade-in zoom-in-95 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/30 dark:border-white/10 shrink-0 bg-[var(--liquid-surface-strong)] backdrop-blur-xl">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <div className={`flex h-7 w-7 items-center justify-center rounded-xl text-white shadow-sm ${
              type === "url"
                ? "bg-gradient-to-br from-pink-500 to-rose-500"
                : "bg-gradient-to-br from-indigo-500 to-purple-500"
            }`}>
              {type === "url" ? (
                <Link2 className="w-4 h-4" />
              ) : (
                <MessageSquare className="w-4 h-4" />
              )}
            </div>
            {type === "url" ? "提交网址" : "建议反馈"}
          </h2>
          <button
            onClick={onClose}
            className="p-2 -mr-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 min-h-0 space-y-5">
          {/* 类型选择 */}
          <div className="liquid-chip grid grid-cols-2 gap-1 rounded-2xl p-1">
            <button
              type="button"
              onClick={() => setType("suggestion")}
              className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                type === "suggestion"
                  ? "bg-white/75 text-slate-900 shadow-sm ring-2 ring-indigo-500 dark:bg-white/15 dark:text-slate-100"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              提建议
            </button>
            <button
              type="button"
              onClick={() => setType("url")}
              className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                type === "url"
                  ? "bg-white/75 text-slate-900 shadow-sm ring-2 ring-pink-500 dark:bg-white/15 dark:text-slate-100"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              <Link2 className="w-4 h-4" />
              提交网址
            </button>
          </div>

          <div className="liquid-chip rounded-2xl px-4 py-3">
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {type === "url"
                ? "如果你发现有价值的网址未被收录，欢迎提交给我们。审核通过后将添加到导航中。"
                : "有任何想法或建议？欢迎告诉我们，帮助我们做得更好。"}
            </p>
          </div>

          {/* 内容输入 */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
              {type === "url" ? (
                <Link2 className="w-3.5 h-3.5 text-pink-500" />
              ) : (
                <Edit3 className="w-3.5 h-3.5 text-indigo-500" />
              )}
              {type === "url" ? "网址 *" : "建议内容 *"}
            </label>
            {type === "url" ? (
              <input
                type="url"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="https://example.com"
                className="liquid-input w-full rounded-2xl px-4 py-3 text-sm dark:text-slate-200"
                required
              />
            ) : (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="请描述您的建议..."
                rows={4}
                maxLength={2000}
                className="liquid-input w-full rounded-2xl px-4 py-3 text-sm dark:text-slate-200 resize-none"
                required
              />
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-400">
                {type === "url" ? "请输入完整的网址，包含 https://" : "请详细描述您的建议，以便我们更好地理解"}
              </span>
              <span className="text-xs text-slate-400 tabular-nums bg-white/30 dark:bg-slate-800/30 rounded-lg px-2 py-0.5">
                {content.length}/2000
              </span>
            </div>
          </div>

          {/* 联系方式 */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
              <Mail className="w-3.5 h-3.5 text-slate-400" />
              联系方式 <span className="text-xs text-slate-400 font-normal">(选填)</span>
            </label>
            <input
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="邮箱或其它联系方式"
              maxLength={200}
              className="liquid-input w-full rounded-2xl px-4 py-3 text-sm dark:text-slate-200"
            />
            <p className="text-xs text-slate-400 flex items-center gap-1">
              <span className="inline-block w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
              方便我们在需要时与您沟通
            </p>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {/* 提交按钮 */}
          <button
            type="submit"
            disabled={loading}
            className="liquid-button-primary w-full flex items-center justify-center gap-2 px-6 py-3 font-medium text-sm group"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                提交中...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                提交
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
