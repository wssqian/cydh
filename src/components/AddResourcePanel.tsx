import { useState, type FormEvent } from "react";
import { Plus, AlertCircle } from "lucide-react";

interface Category {
  id: number;
  name: string;
  slug: string;
}

interface Props {
  categories: Category[];
  onSuccess?: () => void;
}

const adminFetch = async (input: string, init?: RequestInit) => {
  const r = await fetch(input, { ...init, credentials: "same-origin" });
  if (r.status === 401) throw new Error("登录已失效");
  return r;
};

export default function AddResourcePanel({ categories, onSuccess }: Props) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [tags, setTags] = useState("");
  const [isFeatured, setIsFeatured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name || !url || !categoryId) {
      setError("名称、URL 和分类是必填项");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await adminFetch("/api/admin/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          url,
          description,
          category_id: parseInt(categoryId),
          icon_url: iconUrl || null,
          tags: tags || null,
          is_featured: isFeatured ? 1 : 0,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as any;
        throw new Error(data.error || "添加失败");
      }
      // Reset form
      setName(""); setUrl(""); setDescription(""); setCategoryId("");
      setIconUrl(""); setTags(""); setIsFeatured(false);
      onSuccess?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="liquid-panel rounded-[2rem] p-6">
      <h2 className="text-xl font-semibold flex items-center gap-2 mb-6">
        <Plus className="w-5 h-5 text-indigo-500" />
        添加新资源
      </h2>
      {error && (
        <div className="liquid-chip mb-6 p-4 rounded-2xl text-red-600 flex items-start gap-2 dark:text-red-400">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="liquid-input rounded-2xl px-3 py-2.5" placeholder="网站名称" />
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} className="liquid-input rounded-2xl px-3 py-2.5" placeholder="链接 URL" />
        </div>
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className="liquid-input w-full rounded-2xl px-3 py-2.5" placeholder="简短的网站描述" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="liquid-input rounded-2xl px-3 py-2.5">
            <option value="">选择分类...</option>
            {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
          </select>
          <input type="url" value={iconUrl} onChange={(e) => setIconUrl(e.target.value)} className="liquid-input rounded-2xl px-3 py-2.5" placeholder="图标 URL" />
        </div>
        <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} className="liquid-input w-full rounded-2xl px-3 py-2.5" placeholder="标签，以逗号分隔" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} />
          设为推荐
        </label>
        <button type="submit" disabled={loading} className="liquid-button-primary px-6 py-2.5 font-medium">
          {loading ? "添加中..." : "添加资源"}
        </button>
      </form>
    </div>
  );
}
