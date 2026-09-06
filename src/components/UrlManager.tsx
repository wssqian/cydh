import { useState, useEffect, useMemo, useCallback, type FormEvent } from "react";
import {
  Link2,
  Plus,
  Trash2,
  Search,
  Filter,
  Download,
  Upload,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Loader2,
  RefreshCw,
  Edit3,
  X,
  Save,
  Globe,
  Tags,
  Image,
  Star,
  FileDown,
  FileUp,
  FolderTree,
  MoveRight,
  Settings2,
  ChevronDown,
  ChevronRight,
  Bookmark,
  List,
} from "lucide-react";
import type { Category, SiteResponse } from "../types";
import { announceNavigationDataUpdated } from "../navigation-data";

interface UrlManagerProps {
  initialCategories: Category[];
  initialSites: SiteResponse[];
  onDataChange?: () => void;
}

export default function UrlManager({ initialCategories, initialSites, onDataChange }: UrlManagerProps) {
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [sites, setSites] = useState<SiteResponse[]>(initialSites);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterFeatured, setFilterFeatured] = useState<string>("all");

  // Add site form
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [tags, setTags] = useState("");
  const [isFeatured, setIsFeatured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Edit
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [editIconUrl, setEditIconUrl] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editIsFeatured, setEditIsFeatured] = useState(false);
  const [editLoading, setEditLoading] = useState(false);

  // Bulk operations
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showBatchMove, setShowBatchMove] = useState(false);
  const [batchMoveCategoryId, setBatchMoveCategoryId] = useState<string>("");

  // ★ 分类管理
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  // 编辑分类
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [editCatName, setEditCatName] = useState("");
  const [editCatIcon, setEditCatIcon] = useState("");
  // 新建分类
  const [newCatName, setNewCatName] = useState("");
  const [newCatIcon, setNewCatIcon] = useState("");
  const [catLoading, setCatLoading] = useState(false);

  // Import/Export
  const [importText, setImportText] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; failed: number; errors: string[] } | null>(null);
  const [importCategoryId, setImportCategoryId] = useState<number | null>(categories[0]?.id || null);
  const [importFormat, setImportFormat] = useState<"json" | "text" | "auto">("auto");

  const adminFetch = async (input: string, init?: RequestInit) => {
    const response = await fetch(input, { ...init, credentials: "same-origin" });
    if (response.status === 401) {
      throw new Error("登录已失效");
    }
    return response;
  };

  const readError = async (response: Response, fallback: string) => {
    try {
      const result = await response.json() as { error?: string };
      return result.error || fallback;
    } catch {
      return fallback;
    }
  };

  // Refresh data
  const refreshData = async () => {
    try {
      const [catRes, siteRes] = await Promise.all([
        adminFetch("/api/admin/categories"),
        adminFetch("/api/admin/sites"),
      ]);
      if (catRes.ok && siteRes.ok) {
        setCategories(await catRes.json());
        setSites(await siteRes.json());
        onDataChange?.();
      }
    } catch { /* ignore */ }
  };

  // Filtered & limited sites
  const filteredSites = useMemo(() => sites.filter((site) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!site.name.toLowerCase().includes(q) && !site.url.toLowerCase().includes(q) && !site.description?.toLowerCase().includes(q)) {
        return false;
      }
    }
    if (filterCategory !== "all" && site.category_id !== parseInt(filterCategory)) return false;
    if (filterFeatured === "featured" && !site.is_featured) return false;
    if (filterFeatured === "normal" && site.is_featured) return false;
    return true;
  }), [sites, searchQuery, filterCategory, filterFeatured]);

  const RENDER_LIMIT = 50;
  const [showAllSites, setShowAllSites] = useState(false);
  const visibleSites = showAllSites ? filteredSites : filteredSites.slice(0, RENDER_LIMIT);

  // ─── 站点 CRUD ──────────────────────────────────────────────

  const handleAddSite = async (event: FormEvent) => {
    event.preventDefault();
    if (!name || !url || !categoryId) {
      setError("名称、URL 和分类是必填项");
      return;
    }
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const response = await adminFetch("/api/admin/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, url, description,
          category_id: parseInt(categoryId, 10),
          icon_url: iconUrl,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          is_featured: isFeatured,
        }),
      });
      if (!response.ok) throw new Error(await readError(response, "添加失败"));
      setSuccess(`"${name}" 添加成功`);
      setName(""); setUrl(""); setDescription(""); setIconUrl(""); setTags(""); setIsFeatured(false);
      announceNavigationDataUpdated();
      await refreshData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (site: SiteResponse) => {
    setEditingId(site.id);
    setEditName(site.name);
    setEditUrl(site.url);
    setEditDescription(site.description || "");
    setEditCategoryId(String(site.category_id));
    setEditIconUrl(site.icon_url || "");
    setEditTags((site.tags || []).join(", "));
    setEditIsFeatured(site.is_featured === 1);
  };

  const cancelEdit = () => { setEditingId(null); };

  const handleEditSite = async (id: number) => {
    if (!editName || !editUrl || !editCategoryId) {
      setError("名称、URL 和分类是必填项");
      return;
    }
    setEditLoading(true);
    setError("");
    setSuccess("");
    try {
      const response = await adminFetch(`/api/admin/sites/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName, url: editUrl, description: editDescription,
          category_id: parseInt(editCategoryId, 10),
          icon_url: editIconUrl,
          tags: editTags.split(",").map((t) => t.trim()).filter(Boolean),
          is_featured: editIsFeatured,
        }),
      });
      if (!response.ok) throw new Error(await readError(response, "更新失败"));
      setSuccess(`"${editName}" 更新成功`);
      setEditingId(null);
      announceNavigationDataUpdated();
      await refreshData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setEditLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("确定要删除此资源吗？")) return;
    try {
      await adminFetch(`/api/admin/sites/${id}`, { method: "DELETE" });
      announceNavigationDataUpdated();
      await refreshData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ─── 分类管理 ──────────────────────────────────────────────

  const handleAddCategory = async () => {
    if (!newCatName.trim()) { setError("分类名称不能为空"); return; }
    setCatLoading(true);
    try {
      const res = await adminFetch("/api/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCatName.trim(), icon: newCatIcon.trim() || null }),
      });
      if (!res.ok) throw new Error(await readError(res, "创建分类失败"));
      setSuccess(`分类「${newCatName}」创建成功`);
      setNewCatName(""); setNewCatIcon("");
      await refreshData();
    } catch (err: any) {
      setError(err.message);
    } finally { setCatLoading(false); }
  };

  const handleEditCategory = async (id: number) => {
    if (!editCatName.trim()) { setError("分类名称不能为空"); return; }
    setCatLoading(true);
    try {
      const res = await adminFetch(`/api/admin/categories/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editCatName.trim(), icon: editCatIcon.trim() || null }),
      });
      if (!res.ok) throw new Error(await readError(res, "更新分类失败"));
      setSuccess(`分类已更新`);
      setEditingCatId(null);
      await refreshData();
    } catch (err: any) {
      setError(err.message);
    } finally { setCatLoading(false); }
  };

  const handleDeleteCategory = async (id: number) => {
    const cat = categories.find(c => c.id === id);
    const siteCount = sites.filter(s => s.category_id === id).length;
    let msg = `确定要删除分类「${cat?.name}」吗？`;
    if (siteCount > 0) {
      msg = `分类「${cat?.name}」下有 ${siteCount} 个站点。\n\n选择「确定」后，需要指定一个目标分类来迁移这些站点。`;
    }
    if (!window.confirm(msg)) return;

    if (siteCount > 0) {
      // 需要选择一个目标分类
      const target = window.prompt(`请输入目标分类 ID 来迁移「${cat?.name}」下的 ${siteCount} 个站点：\n可用的分类：\n${categories.filter(c => c.id !== id).map(c => `  ${c.id}: ${c.name}`).join("\n")}`);
      if (!target) return;
      const targetId = parseInt(target, 10);
      if (!Number.isInteger(targetId) || targetId < 1 || targetId === id) {
        setError("无效的目标分类 ID");
        return;
      }
      try {
        const res = await adminFetch(`/api/admin/categories/${id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ move_to: targetId }),
        });
        if (!res.ok) throw new Error(await readError(res, "删除分类失败"));
        setSuccess(`分类「${cat?.name}」已删除，站点已迁移`);
        announceNavigationDataUpdated();
        await refreshData();
      } catch (err: any) { setError(err.message); }
    } else {
      try {
        const res = await adminFetch(`/api/admin/categories/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(await readError(res, "删除分类失败"));
        setSuccess(`分类「${cat?.name}」已删除`);
        announceNavigationDataUpdated();
        await refreshData();
      } catch (err: any) { setError(err.message); }
    }
  };

  // ─── 批量操作 ──────────────────────────────────────────────

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`确定要删除选中的 ${selectedIds.size} 个资源吗？`)) return;
    setBulkLoading(true);
    try {
      const res = await adminFetch("/api/admin/sites/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteIds: Array.from(selectedIds) }),
      });
      if (!res.ok) throw new Error(await readError(res, "批量删除失败"));
      const result = await res.json() as { deleted: number };
      setSuccess(`已删除 ${result.deleted} 个资源`);
      setSelectedIds(new Set());
      announceNavigationDataUpdated();
      await refreshData();
    } catch (err: any) {
      setError(err.message);
    } finally { setBulkLoading(false); }
  };

  const handleBatchMove = async () => {
    if (selectedIds.size === 0 || !batchMoveCategoryId) return;
    if (!window.confirm(`确定要将选中的 ${selectedIds.size} 个资源移动到目标分类吗？`)) return;
    setBulkLoading(true);
    try {
      const res = await adminFetch("/api/admin/sites/batch-move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteIds: Array.from(selectedIds),
          toCategoryId: parseInt(batchMoveCategoryId, 10),
        }),
      });
      if (!res.ok) throw new Error(await readError(res, "批量移动失败"));
      const result = await res.json() as { moved: number };
      setSuccess(`已移动 ${result.moved} 个资源`);
      setSelectedIds(new Set());
      setShowBatchMove(false);
      announceNavigationDataUpdated();
      await refreshData();
    } catch (err: any) {
      setError(err.message);
    } finally { setBulkLoading(false); }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredSites.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredSites.map((s) => s.id)));
    }
  };

  // ─── 导出 ──────────────────────────────────────────────────

  const handleExport = () => {
    const exportData = {
      exportType: "navigation-sites",
      exportedAt: new Date().toISOString(),
      totalSites: sites.length,
      sites: sites.map((site) => ({
        name: site.name,
        url: site.url,
        description: site.description,
        category: categories.find((c) => c.id === site.category_id)?.name || "",
        category_id: site.category_id,
        tags: (site.tags || []).join(", "),
        icon_url: site.icon_url,
        is_featured: site.is_featured,
      })),
      categories: categories.map((cat) => ({
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        icon: cat.icon,
        sort_order: cat.sort_order,
      })),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url2 = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url2;
    a.download = `navigation-full-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url2);
  };

  // ─── 导入 ──────────────────────────────────────────────────

  /** 解析导入文本，支持 JSON / 纯文本 / HTML 书签 */
  const parseImportText = (text: string): any[] => {
    const trimmed = text.trim();

    // 尝试 JSON 解析
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
      // 可能是包装格式
      if (parsed.sites && Array.isArray(parsed.sites)) return parsed.sites;
      if (parsed.data && Array.isArray(parsed.data)) return parsed.data;
      return [parsed]; // 单个对象
    } catch { /* 不是 JSON，继续 */ }

    // 检查是否是 HTML 书签格式
    if (trimmed.includes("<!DOCTYPE") || trimmed.includes("<DT>") || trimmed.includes("<A HREF=")) {
      const bookmarkItems: any[] = [];
      // 简单解析 <A HREF="..." ADD_DATE="..." ICON="...">标题</A>
      const linkRegex = /<A\s+HREF="([^"]*)"[^>]*>(.*?)<\/A>/gi;
      let match;
      while ((match = linkRegex.exec(trimmed)) !== null) {
        bookmarkItems.push({
          name: match[2].trim(),
          url: match[1],
        });
      }
      return bookmarkItems;
    }

    // 按行解析
    const lines = trimmed.split("\n").filter(l => l.trim());
    if (lines.length === 0) return [];

    // 检查是否 CSV 格式 (name,url)
    if (lines[0].includes(",") && lines[0].includes("http")) {
      return lines.map(line => {
        const parts = line.split(",").map(s => s.trim());
        return { name: parts[0], url: parts[1] || parts[0] };
      });
    }

    // 每行一个 URL
    return lines.map(line => {
      const l = line.trim();
      if (l.startsWith("http")) return { url: l, name: l };
      // 可能 "名称 - url" 或 "名称 url" 格式
      const sep = l.search(/[\s\-—|]+http/);
      if (sep > 0) {
        return { name: l.slice(0, sep).trim(), url: l.slice(sep).trim() };
      }
      return { name: l, url: `https://${l}` };
    });
  };

  const handleImport = async () => {
    setImportLoading(true);
    setImportResult(null);
    try {
      const items = parseImportText(importText);
      if (items.length === 0) throw new Error("没有可导入的内容");

      let success = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const item of items) {
        try {
          let catId: number | undefined;
          if (item.category) {
            const cat = categories.find((c) => c.name === item.category);
            catId = cat?.id;
            if (!catId) {
              try {
                const createRes = await adminFetch("/api/admin/categories", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: item.category }),
                });
                if (createRes.ok) {
                  const newCat = await createRes.json() as { id: number; name: string };
                  catId = newCat.id;
                } else {
                  failed++;
                  errors.push(`${item.name || item.url}: 创建分类失败`);
                  continue;
                }
              } catch (createErr: any) {
                failed++;
                errors.push(`${item.name || item.url}: ${createErr.message}`);
                continue;
              }
            }
          } else if (importCategoryId) {
            catId = importCategoryId;
          } else {
            failed++;
            errors.push(`${item.name || item.url}: 请选择默认分类`);
            continue;
          }

          // 检查是否已存在相同 URL
          const existing = sites.find(s => s.url === item.url);
          if (existing) {
            // 跳过已存在的
            success++;
            continue;
          }

          const response = await adminFetch("/api/admin/sites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: item.name || item.url,
              url: item.url,
              description: item.description || "",
              category_id: catId,
              icon_url: item.icon_url || "",
              tags: (item.tags || "").split(",").map((t: string) => t.trim()).filter(Boolean),
              is_featured: item.is_featured || false,
            }),
          });

          if (response.ok) {
            success++;
          } else {
            failed++;
            const errMsg = await readError(response, "导入失败");
            errors.push(`${item.name || item.url}: ${errMsg}`);
          }
        } catch (err: any) {
          failed++;
          errors.push(`${item.name || item.url}: ${err.message}`);
        }
      }

      setImportResult({ success, failed, errors });
      if (success > 0) {
        announceNavigationDataUpdated();
        await refreshData();
      }
    } catch (err: any) {
      setImportResult({ success: 0, failed: 1, errors: [err.message] });
    } finally {
      setImportLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ─── 工具栏 ─── */}
      <div className="flex items-center flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索名称、URL 或描述..."
            className="liquid-input w-full rounded-2xl pl-9 pr-3 py-2.5 text-sm"
          />
        </div>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="liquid-input rounded-2xl px-3 py-2.5 text-sm"
        >
          <option value="all">全部分类</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </select>
        <select
          value={filterFeatured}
          onChange={(e) => setFilterFeatured(e.target.value)}
          className="liquid-input rounded-2xl px-3 py-2.5 text-sm"
        >
          <option value="all">全部状态</option>
          <option value="featured">推荐</option>
          <option value="normal">普通</option>
        </select>
        <button onClick={refreshData} className="liquid-button p-2.5 text-slate-500" title="刷新">
          <RefreshCw className="w-4 h-4" />
        </button>
        <button
          onClick={() => setShowCategoryManager(!showCategoryManager)}
          className={`liquid-button flex items-center gap-1.5 px-3 py-2 text-sm ${showCategoryManager ? 'text-pink-500' : ''}`}
        >
          <FolderTree className="w-4 h-4" />
          分类管理
        </button>
      </div>

      {/* 成功/错误提示 */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
          <button onClick={() => setError("")} className="ml-auto text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl px-4 py-3">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {success}
          <button onClick={() => setSuccess("")} className="ml-auto text-emerald-400 hover:text-emerald-600"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* ─── 分类管理面板 ─── */}
      {showCategoryManager && (
        <div className="liquid-panel rounded-[2rem] p-6 space-y-4">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <FolderTree className="w-4 h-4 text-pink-500" />
            分类管理
            <span className="liquid-chip text-xs text-slate-500 px-2 py-0.5 rounded-full ml-2">{categories.length} 个分类</span>
          </h3>

          {/* 新建分类 */}
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[150px]">
              <label className="text-xs text-slate-500 block mb-1">新分类名称</label>
              <input type="text" value={newCatName} onChange={(e) => setNewCatName(e.target.value)}
                className="liquid-input w-full rounded-xl px-3 py-2 text-sm" placeholder="例如：AI 工具" />
            </div>
            <div className="flex-1 min-w-[120px]">
              <label className="text-xs text-slate-500 block mb-1">图标名 (可选)</label>
              <input type="text" value={newCatIcon} onChange={(e) => setNewCatIcon(e.target.value)}
                className="liquid-input w-full rounded-xl px-3 py-2 text-sm" placeholder="Bot / Wrench..." />
            </div>
            <button onClick={handleAddCategory} disabled={catLoading || !newCatName.trim()}
              className="liquid-button-primary flex items-center gap-1.5 px-4 py-2.5 text-sm">
              <Plus className="w-4 h-4" />
              添加分类
            </button>
          </div>

          {/* 分类列表 */}
          <div className="max-h-64 overflow-y-auto space-y-1">
            {categories.map((cat) => (
              <div key={cat.id} className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-white/25 dark:hover:bg-white/5 group">
                {editingCatId === cat.id ? (
                  <>
                    <input type="text" value={editCatName} onChange={(e) => setEditCatName(e.target.value)}
                      className="liquid-input flex-1 rounded-xl px-2 py-1 text-sm" />
                    <input type="text" value={editCatIcon} onChange={(e) => setEditCatIcon(e.target.value)}
                      className="liquid-input w-24 rounded-xl px-2 py-1 text-sm" placeholder="图标" />
                    <button onClick={() => handleEditCategory(cat.id)} disabled={catLoading}
                      className="text-emerald-500 hover:text-emerald-600 p-1"><Save className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setEditingCatId(null)}
                      className="text-slate-400 hover:text-slate-600 p-1"><X className="w-3.5 h-3.5" /></button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm">{cat.name}</span>
                    <span className="text-xs text-slate-400">
                      {sites.filter(s => s.category_id === cat.id).length} 站点
                    </span>
                    <button onClick={() => { setEditingCatId(cat.id); setEditCatName(cat.name); setEditCatIcon(cat.icon || ""); }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-indigo-500 transition-opacity">
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleDeleteCategory(cat.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 transition-opacity">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── 快捷操作栏 ─── */}
      <div className="flex items-center gap-2 flex-wrap">
        {selectedIds.size > 0 && (
          <>
            <button
              onClick={handleBulkDelete}
              disabled={bulkLoading}
              className="liquid-button flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 dark:text-red-400"
            >
              <Trash2 className="w-4 h-4" />
              删除选中 ({selectedIds.size})
            </button>
            <button
              onClick={() => setShowBatchMove(!showBatchMove)}
              className="liquid-button flex items-center gap-1.5 px-3 py-2 text-sm text-indigo-600 dark:text-indigo-400"
            >
              <MoveRight className="w-4 h-4" />
              移动选中 ({selectedIds.size})
            </button>
          </>
        )}
        <button onClick={handleExport} className="liquid-button flex items-center gap-1.5 px-3 py-2 text-sm">
          <FileDown className="w-4 h-4" />
          导出 (含分类)
        </button>
        <button onClick={() => setShowImport(!showImport)} className="liquid-button flex items-center gap-1.5 px-3 py-2 text-sm">
          <FileUp className="w-4 h-4" />
          导入
        </button>
      </div>

      {/* 批量移动面板 */}
      {showBatchMove && selectedIds.size > 0 && (
        <div className="liquid-chip rounded-2xl p-4 flex items-center gap-3 flex-wrap">
          <span className="text-sm text-slate-600">将选中的 {selectedIds.size} 个资源移动到：</span>
          <select
            value={batchMoveCategoryId}
            onChange={(e) => setBatchMoveCategoryId(e.target.value)}
            className="liquid-input rounded-xl px-3 py-1.5 text-sm"
          >
            <option value="">选择目标分类...</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
          <button onClick={handleBatchMove} disabled={bulkLoading || !batchMoveCategoryId}
            className="liquid-button-primary flex items-center gap-1.5 px-4 py-1.5 text-sm">
            <MoveRight className="w-4 h-4" />
            移动
          </button>
          <button onClick={() => { setShowBatchMove(false); setBatchMoveCategoryId(""); }}
            className="text-sm text-slate-500">取消</button>
        </div>
      )}

      {/* ─── 导入面板 ─── */}
      {showImport && (
        <div className="liquid-chip rounded-2xl p-4 space-y-3">
          <h4 className="text-sm font-medium text-slate-700 dark:text-slate-200">导入资源</h4>
          <p className="text-xs text-slate-500">
            支持以下格式：
            <span className="block mt-1 space-x-2">
              <span className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-[10px]">JSON 数组</span>
              <span className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-[10px]">一行一个 URL</span>
              <span className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-[10px]">HTML 书签</span>
              <span className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-[10px]">CSV (name,url)</span>
            </span>
          </p>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600 shrink-0">默认分类:</label>
            <select
              value={importCategoryId || ""}
              onChange={(e) => setImportCategoryId(e.target.value ? Number(e.target.value) : null)}
              className="liquid-input rounded-2xl px-3 py-1.5 text-sm flex-1"
            >
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={6}
            className="liquid-input w-full rounded-2xl px-4 py-3 text-sm font-mono resize-none"
            placeholder={`支持多种格式，例如：\n\nJSON:\n[{"name":"Example","url":"https://example.com","category":"影音娱乐"}]\n\n纯文本 (每行一个 URL):\nhttps://example.com\nhttps://another.com\n\nHTML 书签:\n<DT><A HREF="https://example.com">Example</A>`}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleImport}
              disabled={importLoading || !importText.trim()}
              className="liquid-button-primary flex items-center gap-1.5 px-4 py-2 text-sm"
            >
              {importLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {importLoading ? "导入中..." : "开始导入"}
            </button>
            <button onClick={() => { setShowImport(false); setImportText(""); setImportResult(null); }} className="text-sm text-slate-500">
              取消
            </button>
          </div>
          {importResult && (
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-sm">
                <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> 成功: {importResult.success}</span>
                {importResult.failed > 0 && <span className="text-red-500 flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> 失败: {importResult.failed}</span>}
              </div>
              {importResult.errors.length > 0 && (
                <div className="max-h-32 overflow-y-auto text-xs text-red-500 space-y-1 bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
                  {importResult.errors.map((err, i) => <div key={i}>{err}</div>)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── 添加新资源表单 ─── */}
      <div className="liquid-panel rounded-[2rem] p-6">
        <h3 className="text-base font-semibold flex items-center gap-2 mb-4">
          <Plus className="w-4 h-4 text-indigo-500" />
          添加新资源
        </h3>
        <form onSubmit={handleAddSite} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="liquid-input rounded-2xl px-3 py-2.5" placeholder="网站名称 *" />
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} className="liquid-input rounded-2xl px-3 py-2.5" placeholder="链接 URL *" />
          </div>
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className="liquid-input w-full rounded-2xl px-3 py-2.5" placeholder="简短的网站描述" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="liquid-input rounded-2xl px-3 py-2.5">
              <option value="">选择分类 *</option>
              {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
            </select>
            <input type="url" value={iconUrl} onChange={(e) => setIconUrl(e.target.value)} className="liquid-input rounded-2xl px-3 py-2.5" placeholder="图标 URL (可选)" />
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

      {/* ─── 资源列表 ─── */}
      <div className="liquid-panel rounded-[2rem] overflow-hidden">
        <div className="px-6 py-4 border-b border-white/30 dark:border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Link2 className="w-5 h-5 text-slate-400" />
              资源列表
            </h2>
            <span className="liquid-chip text-sm text-slate-500 px-2.5 py-0.5 rounded-full">
              {filteredSites.length}/{sites.length}
            </span>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <input
              type="checkbox"
              checked={selectedIds.size === filteredSites.length && filteredSites.length > 0}
              onChange={toggleSelectAll}
              className="rounded"
            />
            全选
          </label>
        </div>

        <div className="divide-y divide-white/25 dark:divide-white/10 max-h-[500px] overflow-y-auto">
          {visibleSites.map((site) => (
            <div key={site.id} className="p-4 sm:px-6 flex items-start gap-3 hover:bg-white/25 dark:hover:bg-white/5 group" style={{ contentVisibility: 'auto', containIntrinsicSize: '0 72px' }}>
              <input
                type="checkbox"
                checked={selectedIds.has(site.id)}
                onChange={() => toggleSelect(site.id)}
                className="mt-1.5 rounded"
              />

              {editingId === site.id ? (
                <div className="flex-1 space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                      className="liquid-input rounded-xl px-3 py-2 text-sm" placeholder="名称" />
                    <input type="url" value={editUrl} onChange={(e) => setEditUrl(e.target.value)}
                      className="liquid-input rounded-xl px-3 py-2 text-sm" placeholder="URL" />
                  </div>
                  <input type="text" value={editDescription} onChange={(e) => setEditDescription(e.target.value)}
                    className="liquid-input w-full rounded-xl px-3 py-2 text-sm" placeholder="描述" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select value={editCategoryId} onChange={(e) => setEditCategoryId(e.target.value)}
                      className="liquid-input rounded-xl px-3 py-2 text-sm">
                      {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                    </select>
                    <input type="url" value={editIconUrl} onChange={(e) => setEditIconUrl(e.target.value)}
                      className="liquid-input rounded-xl px-3 py-2 text-sm" placeholder="图标 URL" />
                  </div>
                  <input type="text" value={editTags} onChange={(e) => setEditTags(e.target.value)}
                    className="liquid-input w-full rounded-xl px-3 py-2 text-sm" placeholder="标签，逗号分隔" />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={editIsFeatured} onChange={(e) => setEditIsFeatured(e.target.checked)} />
                    推荐
                  </label>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleEditSite(site.id)} disabled={editLoading}
                      className="liquid-button-primary flex items-center gap-1 px-3 py-1.5 text-xs">
                      {editLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      保存
                    </button>
                    <button onClick={cancelEdit} className="liquid-button flex items-center gap-1 px-3 py-1.5 text-xs">
                      <X className="w-3 h-3" />
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{site.name}</span>
                      <span className="liquid-chip text-xs text-slate-500 px-2 py-0.5 rounded-md shrink-0">
                        {site.category_name}
                      </span>
                      {site.is_featured === 1 && (
                        <span className="liquid-chip text-xs text-amber-600 px-2 py-0.5 rounded-md shrink-0 flex items-center gap-1">
                          <Star className="w-3 h-3" />
                          推荐
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500 truncate mt-0.5">{site.url}</p>
                    {site.description && (
                      <p className="text-xs text-slate-400 truncate mt-0.5">{site.description}</p>
                    )}
                    {site.tags && site.tags.length > 0 && (
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {site.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                            {tag}
                          </span>
                        ))}
                        {site.tags.length > 3 && (
                          <span className="text-[10px] text-slate-400">+{site.tags.length - 3}</span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <a href={site.url} target="_blank" rel="noopener noreferrer"
                      className="p-1.5 text-slate-400 hover:text-blue-500" title="打开">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <button onClick={() => startEdit(site)}
                      className="p-1.5 text-slate-400 hover:text-indigo-500" title="编辑">
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleDelete(site.id)}
                      className="p-1.5 text-slate-400 hover:text-red-500" title="删除">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          {visibleSites.length === 0 && (
            <div className="p-8 text-center text-slate-500">
              {searchQuery || filterCategory !== "all" || filterFeatured !== "all"
                ? "没有匹配的资源"
                : "暂无资源，请添加新资源"}
            </div>
          )}
        </div>

        {filteredSites.length > RENDER_LIMIT && !showAllSites && (
          <div className="border-t border-white/30 dark:border-white/10 px-6 py-3 text-center">
            <button onClick={() => setShowAllSites(true)} className="text-sm text-pink-500 hover:text-pink-600 font-medium">
              显示全部 {filteredSites.length} 个网站
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
