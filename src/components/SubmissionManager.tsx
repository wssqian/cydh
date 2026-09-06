import { useState, useEffect } from "react";
import {
  Inbox,
  MessageSquare,
  Link2,
  CheckCircle2,
  XCircle,
  Loader2,
  Trash2,
  Eye,
  ChevronDown,
  ChevronUp,
  Search,
  AlertCircle,
} from "lucide-react";

interface Submission {
  id: number;
  type: "suggestion" | "url";
  content: string;
  contact: string;
  status: "pending" | "read" | "resolved" | "rejected";
  admin_note: string;
  ip_hash: string;
  created_at: string;
  updated_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "待处理",
  read: "已读",
  resolved: "已解决",
  rejected: "已拒绝",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "text-amber-600 bg-amber-50 dark:bg-amber-900/20",
  read: "text-blue-600 bg-blue-50 dark:bg-blue-900/20",
  resolved: "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20",
  rejected: "text-slate-400 bg-slate-50 dark:bg-slate-800/50",
};

export default function SubmissionManager() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [adminNoteInput, setAdminNoteInput] = useState("");
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const adminFetch = async (input: string, init?: RequestInit) => {
    const response = await fetch(input, { ...init, credentials: "same-origin" });
    if (response.status === 401) throw new Error("登录已失效");
    return response;
  };

  const loadSubmissions = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (typeFilter !== "all") params.set("type", typeFilter);

      const response = await adminFetch(`/api/admin/submissions?${params}`);
      if (!response.ok) throw new Error("读取失败");
      const data = await response.json();
      setSubmissions(data.items);
      setTotal(data.total);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSubmissions();
  }, [page, statusFilter, typeFilter]);

  const updateStatus = async (id: number, status: string) => {
    setUpdatingId(id);
    try {
      const response = await adminFetch(`/api/admin/submissions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, admin_note: adminNoteInput }),
      });
      if (!response.ok) throw new Error("更新失败");
      await loadSubmissions();
      setAdminNoteInput("");
      setExpandedId(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  const deleteSubmission = async (id: number) => {
    if (!window.confirm("确定要删除此提交吗？")) return;
    try {
      await adminFetch(`/api/admin/submissions/${id}`, { method: "DELETE" });
      await loadSubmissions();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="liquid-panel rounded-[2rem] p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Inbox className="w-5 h-5 text-indigo-500" />
          用户提交管理
          <span className="text-sm font-normal text-slate-400">({total} 条)</span>
        </h2>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="liquid-input rounded-2xl px-3 py-2 text-sm"
        >
          <option value="all">全部状态</option>
          <option value="pending">待处理</option>
          <option value="read">已读</option>
          <option value="resolved">已解决</option>
          <option value="rejected">已拒绝</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="liquid-input rounded-2xl px-3 py-2 text-sm"
        >
          <option value="all">全部类型</option>
          <option value="suggestion">建议</option>
          <option value="url">网址提交</option>
        </select>
        <button onClick={loadSubmissions} className="liquid-button p-2 text-slate-500">
          <Loader2 className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-3 mb-4">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          加载中...
        </div>
      ) : submissions.length === 0 ? (
        <div className="text-center py-12 text-slate-500">暂无用户提交</div>
      ) : (
        <div className="space-y-3">
          {submissions.map((sub) => (
            <div key={sub.id} className="liquid-chip rounded-2xl overflow-hidden">
              {/* Summary row */}
              <div
                className="flex items-start gap-3 p-4 cursor-pointer hover:bg-white/30 dark:hover:bg-white/5 transition-colors"
                onClick={() => setExpandedId(expandedId === sub.id ? null : sub.id)}
              >
                <div className="mt-0.5">
                  {sub.type === "url" ? (
                    <Link2 className="w-4 h-4 text-pink-500" />
                  ) : (
                    <MessageSquare className="w-4 h-4 text-indigo-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
                      {sub.type === "url" ? "网址" : "建议"}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[sub.status]}`}>
                      {STATUS_LABELS[sub.status]}
                    </span>
                    <span className="text-xs text-slate-400">{sub.created_at}</span>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-200 line-clamp-2">
                    {sub.content}
                  </p>
                  {sub.contact && (
                    <p className="text-xs text-slate-400 mt-1">联系方式: {sub.contact}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSubmission(sub.id); }}
                    className="p-1.5 text-slate-400 hover:text-red-500"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  {expandedId === sub.id ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                </div>
              </div>

              {/* Expanded detail */}
              {expandedId === sub.id && (
                <div className="px-4 pb-4 pt-0 border-t border-white/30 dark:border-white/10">
                  <div className="mt-3 space-y-3">
                    <div className="text-sm text-slate-600 dark:text-slate-300 bg-white/50 dark:bg-slate-800/50 rounded-xl p-3 whitespace-pre-wrap">
                      {sub.content}
                    </div>

                    {sub.admin_note && (
                      <div className="text-sm">
                        <span className="text-xs font-medium text-slate-500">管理员备注:</span>
                        <p className="mt-1 text-slate-600 dark:text-slate-300 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-3">
                          {sub.admin_note}
                        </p>
                      </div>
                    )}

                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="text"
                        value={updatingId === sub.id ? adminNoteInput : ""}
                        onChange={(e) => setAdminNoteInput(e.target.value)}
                        placeholder="添加管理员备注..."
                        className="liquid-input flex-1 min-w-[150px] rounded-xl px-3 py-2 text-sm"
                        onFocus={() => { setAdminNoteInput(sub.admin_note || ""); setUpdatingId(sub.id); }}
                      />
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {["read", "resolved", "rejected"].map((s) => (
                        <button
                          key={s}
                          onClick={() => updateStatus(sub.id, s)}
                          disabled={updatingId === sub.id}
                          className={`liquid-button flex items-center gap-1 px-3 py-1.5 text-xs font-medium ${
                            sub.status === s ? "ring-2 ring-pink-500" : ""
                          }`}
                        >
                          {updatingId === sub.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : s === "read" ? (
                            <Eye className="w-3 h-3" />
                          ) : s === "resolved" ? (
                            <CheckCircle2 className="w-3 h-3" />
                          ) : (
                            <XCircle className="w-3 h-3" />
                          )}
                          {STATUS_LABELS[s]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="liquid-button px-3 py-1.5 text-sm disabled:opacity-50"
          >
            上一页
          </button>
          <span className="text-sm text-slate-500">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="liquid-button px-3 py-1.5 text-sm disabled:opacity-50"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
