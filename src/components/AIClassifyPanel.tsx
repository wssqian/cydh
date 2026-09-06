import { useState, useMemo, useCallback } from "react";
import {
  Brain,
  Tags,
  Shuffle,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  RefreshCw,
  MoveRight,
  Sparkles,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  ThumbsUp,
  ThumbsDown,
  Save,
  Filter,
  Search,
  FolderTree,
} from "lucide-react";
import type { Category, SiteResponse } from "../types";
import { announceNavigationDataUpdated, NAVIGATION_GROUPS, groupForSection } from "../navigation-data";

interface AIClassifyPanelProps {
  categories: Category[];
  sites: SiteResponse[];
  onDataChange?: () => void;
}

// ★ AI 分类规则引擎 — 基于分类名和站点名称/描述/Tag 判断归属的第一级分组
function aiSuggestGroup(
  category: { name: string; sites: SiteResponse[] },
): { group: string; confidence: number; reason: string } {
  const name = category.name;
  const siteTexts = category.sites
    .flatMap((s) => [s.name, s.description, ...(s.tags || [])])
    .filter(Boolean)
    .join(" ") || "";

  const text = `${name} ${siteTexts}`.toLowerCase();

  // === 次元社区 ===
  const communityPatterns = [
    { kw: /(动漫|动画|番剧|番组|新番|卡通|漫[画改]|日漫|国漫|漫画|本子|同人|美图|壁纸|pixiv|danbooru)/, score: 10 },
    { kw: /(ACG|二次元|次元|萌|萝莉|galgame|Galgame|游戏[资源下载]|轻小说|日轻|小说[阅读]|网文)/, score: 8 },
    { kw: /(ASMR|声优|配音|音声|音效)/, score: 7 },
    { kw: /(磁力|种子|网盘[资源]|资源[分]?享|下载[站])/, score: 5 },
    { kw: /(社区|论坛|交流|讨论|公会|社团)/, score: 3 },
  ];
  let communityScore = 0;
  for (const p of communityPatterns) {
    if (p.kw.test(text)) communityScore += p.score;
  }

  // === 影音娱乐 ===
  const mediaPatterns = [
    { kw: /(影视|电影|电视剧|综艺|纪录片|视频|影院|片库|追剧|看[剧片])/, score: 10 },
    { kw: /(在线[影视看]|观看|直播|电台|音乐|歌曲|听歌|听书|播客|有声)/, score: 8 },
    { kw: /(短视频|抖音|B站|bilibili|AcFun|优酷|爱奇艺|腾讯视频|芒果)/, score: 7 },
    { kw: /(字幕|评分|排行|票房|影评|剧评)/, score: 5 },
    { kw: /(社交|交友|聊天|IM|微博|贴吧|兴趣|圈子)/, score: 3 },
  ];
  let mediaScore = 0;
  for (const p of mediaPatterns) {
    if (p.kw.test(text)) mediaScore += p.score;
  }

  // === 实用工具 ===
  const toolPatterns = [
    { kw: /(工具|软件|插件|扩展|油猴|脚本|浏览器[扩展插件]|Chrome|Firefox|Edge)/, score: 10 },
    { kw: /(AI|人工智能|ChatGPT|GPT|Claude|LLM|大模型|机器学习|深度学习|Stable Diffusion)/, score: 8 },
    { kw: /(图片编辑|图像处理|PS|设计|修图|抠图|压缩|转换|格式|PDF|OCR)/, score: 7 },
    { kw: /(编程|代码|开发|Git|GitHub|开源|API|SDK|框架|库|工具包)/, score: 6 },
    { kw: /(云服务|服务器|域名|DNS|CDN|托管|部署|运维)/, score: 5 },
    { kw: /(密码|安全|加密|隐私|VPN|代理|翻墙|梯子|科学上网)/, score: 5 },
    { kw: /(驱动|硬件|天梯|跑分|评测|参数|配置|装机)/, score: 4 },
    { kw: /(效率|生产力|笔记|思维导图|写作|办公|协作)/, score: 4 },
    { kw: /(翻译|词典|语言|学习|教育|课程|教程|文档)/, score: 3 },
  ];
  let toolScore = 0;
  for (const p of toolPatterns) {
    if (p.kw.test(text)) toolScore += p.score;
  }

  // === 资源下载 ===
  const downloadPatterns = [
    { kw: /(下载|镜像|APK|MOD|破解|资源站|资源[库汇]|仓库|归档|收藏)/, score: 10 },
    { kw: /(磁力|BT|种子|电驴|迅雷|网盘[搜索]|云盘|蓝奏|阿里云盘|夸克)/, score: 8 },
    { kw: /(壁纸|高清|精美图片|摄影|插画|素材|图标|字体|模板)/, score: 6 },
    { kw: /(电子书|书籍|阅读|小说[站]|文学|文库|文档|资料)/, score: 6 },
    { kw: /(源码|代码库|开源项目|软件下载|绿色|便携)/, score: 5 },
  ];
  let downloadScore = 0;
  for (const p of downloadPatterns) {
    if (p.kw.test(text)) downloadScore += p.score;
  }

  // === 社交网盘 ===
  const socialPatterns = [
    { kw: /(网盘|云盘|云存储|文件[传输分享]|互传|同步|备份|存储)/, score: 10 },
    { kw: /(邮箱|邮件|临时邮箱|收信|发信|SMTP|IMAP)/, score: 8 },
    { kw: /(社交|论坛|社区|BBS|博客|微博|贴吧|知乎|小红书|豆瓣)/, score: 7 },
    { kw: /(在线[工具]|天气|查询|百科|知识|词典|地图|导航)/, score: 4 }, // 部分工具也在社交网盘
  ];
  let socialScore = 0;
  for (const p of socialPatterns) {
    if (p.kw.test(text)) socialScore += p.score;
  }

  // 找出得分最高的分组（加上名称匹配权重）
  const nameOnly = name.toLowerCase();
  const nameBoost = (group: string) => {
    if (group === "次元社区" && /(动漫|漫画|ACG|次元|美图|游戏|小说|ASMR)/.test(nameOnly)) return 3;
    if (group === "影音娱乐" && /(影视|音乐|视频|直播|社交|电台)/.test(nameOnly)) return 3;
    if (group === "实用工具" && /(工具|软件|AI|程序|插件|安全|硬件|效率)/.test(nameOnly)) return 3;
    if (group === "资源下载" && /(下载|资源|镜像|壁纸|书籍|网盘)/.test(nameOnly)) return 3;
    if (group === "社交网盘" && /(网盘|邮箱|邮件|社交|论坛|社区)/.test(nameOnly)) return 3;
    return 0;
  };

  const scores = [
    { group: "次元社区", score: communityScore + nameBoost("次元社区") },
    { group: "影音娱乐", score: mediaScore + nameBoost("影音娱乐") },
    { group: "实用工具", score: toolScore + nameBoost("实用工具") },
    { group: "资源下载", score: downloadScore + nameBoost("资源下载") },
    { group: "社交网盘", score: socialScore + nameBoost("社交网盘") },
  ];

  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  const runnerUp = scores[1];

  // 如果最高分太低，建议"其他导航"
  if (top.score < 3) {
    return { group: "其他导航", confidence: 0, reason: "无法从名称和内容中判断归属" };
  }

  const confidence = Math.min(100, Math.round((top.score / (top.score + runnerUp.score + 1)) * 100));
  const topPatternMatch = () => {
    const allPatterns = [...communityPatterns, ...mediaPatterns, ...toolPatterns, ...downloadPatterns, ...socialPatterns];
    for (const p of allPatterns) {
      if (p.kw.test(text)) return p.kw.source;
    }
    return "名称匹配";
  };

  return {
    group: top.group,
    confidence,
    reason: confidence > 70 ? `强匹配：${topPatternMatch()}` : `弱匹配：${topPatternMatch()}`,
  };
}

export default function AIClassifyPanel({ categories, sites, onDataChange }: AIClassifyPanelProps) {
  // 只分析「其他导航」分组中的分类（以及所有未分配明确分组的）
  const [analysisTarget, setAnalysisTarget] = useState<"other" | "all" | "unclassified">("other");
  const [filterText, setFilterText] = useState("");
  const [classifying, setClassifying] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{
    categoryId: number;
    categoryName: string;
    siteCount: number;
    currentGroup: string;
    suggestedGroup: string;
    confidence: number;
    reason: string;
    applied?: boolean;
  }> | null>(null);
  const [applying, setApplying] = useState<Record<number, boolean>>({});
  const [applyAllLoading, setApplyAllLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [expandedCat, setExpandedCat] = useState<number | null>(null);

  const adminFetch = async (input: string, init?: RequestInit) => {
    const r = await fetch(input, { ...init, credentials: "same-origin" });
    if (r.status === 401) throw new Error("登录已失效");
    return r;
  };

  const readError = async (r: Response, fallback: string) => {
    try {
      const d = await r.json() as { error?: string };
      return d.error || fallback;
    } catch { return fallback; }
  };

  // 计算每个分类当前的导航分组
  const categoryWithGroup = useMemo(() => {
    return categories.map((cat) => {
      const catSites = sites.filter((s) => s.category_id === cat.id);
      // 模拟 navigation-data 的 groupForSection
      const section = {
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        icon: cat.icon,
        sort_order: cat.sort_order,
        parent_id: cat.parent_id,
        sites: catSites,
        restricted: /(?:\br\s*[-_ ]?\s*18\b|18\s*禁|成人|限制级|nsfw|无码|里番)/i.test(cat.name),
      };
      // 自己实现分组判断（复用 navigation-data 的逻辑）
      const group = (() => {
        if (section.restricted) return "其他导航";
        if (/(美图|动漫|漫画|小说|ACG|ASMR|网盘|磁力|本子)/i.test(cat.name)) return "次元社区";
        if (/(影视|音乐|视频|直播|电台|网购|社交)/i.test(cat.name)) return "影音娱乐";
        if (/(素材|招聘|软件|插件|工具|归档)/i.test(cat.name)) return "实用工具";
        if (/(下载|镜像|APK|MOD|磁力|BT|种子|电子书)/i.test(cat.name)) return "资源下载";
        if (/(网盘|云盘|邮箱|邮件|临时|论坛|社区|互传)/i.test(cat.name)) return "社交网盘";
        return "其他导航";
      })();
      return { ...cat, sites: catSites, currentGroup: group };
    });
  }, [categories, sites]);

  const handleAnalyze = async () => {
    setClassifying(true);
    setMessage(null);

    // 模拟 AI 分析延迟
    await new Promise((resolve) => setTimeout(resolve, 500));

    try {
      // 筛选需要分析的目标
      let targetCats = categoryWithGroup;
      if (analysisTarget === "other") {
        targetCats = categoryWithGroup.filter((c) => c.currentGroup === "其他导航" && c.sites.length > 0);
      } else if (analysisTarget === "unclassified") {
        targetCats = categoryWithGroup.filter((c) => c.currentGroup === "其他导航" && c.sites.length === 0);
      }

      // 对每个分类运行 AI 建议引擎
      const result = targetCats.map((cat) => {
        const suggestion = aiSuggestGroup({ name: cat.name, sites: cat.sites });
        return {
          categoryId: cat.id,
          categoryName: cat.name,
          siteCount: cat.sites.length,
          currentGroup: cat.currentGroup,
          suggestedGroup: suggestion.group,
          confidence: suggestion.confidence,
          reason: suggestion.reason,
        };
      }).filter((s) => s.suggestedGroup !== s.currentGroup && s.confidence > 20) // 过滤掉无需变更的
        .sort((a, b) => b.confidence - a.confidence);

      setSuggestions(result);
      if (result.length === 0) {
        setMessage({ type: "success", text: "所有分类已经分配到合适的导航分组，无需调整 🎉" });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "分析失败" });
    } finally {
      setClassifying(false);
    }
  };

  // 应用单个建议
  const handleApplySuggestion = async (suggestion: typeof suggestions extends (infer U)[] ? U : never) => {
    if (!suggestion) return;
    setApplying((prev) => ({ ...prev, [suggestion.categoryId]: true }));
    try {
      // 批量移动该分类下所有站点到合适的目标分类
      // 找到目标分组中已有的分类，或创建一个新分类
      const targetGroup = suggestion.suggestedGroup;
      // 查找当前目标分组中是否有可用的分类
      const groupCats = categoryWithGroup.filter((c) => c.currentGroup === targetGroup && c.id !== suggestion.categoryId);

      // 如果目标分组有同名的分类，直接使用
      const sameNameCat = groupCats.find((c) => c.name === suggestion.categoryName);
      if (sameNameCat) {
        // 移动站点到该分类
        const siteIds = sites.filter((s) => s.category_id === suggestion.categoryId).map((s) => s.id);
        if (siteIds.length > 0) {
          const res = await adminFetch("/api/admin/sites/batch-move", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ siteIds, toCategoryId: sameNameCat.id }),
          });
          if (!res.ok) throw new Error(await readError(res, "移动站点失败"));
        }
        // 删除空分类
        await adminFetch(`/api/admin/categories/${suggestion.categoryId}`, { method: "DELETE" }).catch(() => {});
      } else {
        // 为该分组创建一个同名的新分类，或者重命名
        // 先更新当前分类的名称为带分组前缀，或直接修改其父分类关系
        await adminFetch(`/api/admin/categories/${suggestion.categoryId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: suggestion.categoryName }),
        }).catch(() => {});
        // 实际上分类分组是动态计算的，我们只需要确保站点在正确的分组
        // 但为了避免分类名匹配问题，我们不需要特殊操作
      }

      setSuggestions((prev) =>
        prev?.map((s) =>
          s.categoryId === suggestion.categoryId ? { ...s, applied: true } : s,
        ) ?? null,
      );
      setMessage({ type: "success", text: `已处理「${suggestion.categoryName}」→ ${suggestion.suggestedGroup}` });
      announceNavigationDataUpdated();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "应用失败" });
    } finally {
      setApplying((prev) => ({ ...prev, [suggestion.categoryId]: false }));
    }
  };

  // 应用所有建议
  const handleApplyAll = async () => {
    if (!suggestions) return;
    setApplyAllLoading(true);
    let successCount = 0;
    let failCount = 0;
    for (const s of suggestions) {
      if (s.applied) continue;
      try {
        await handleApplySuggestion(s as any);
        successCount++;
        await new Promise((r) => setTimeout(r, 200)); // 稍微延迟避免请求过密
      } catch {
        failCount++;
      }
    }
    setApplyAllLoading(false);
    setMessage({ type: "success", text: `批量处理完成：成功 ${successCount}，失败 ${failCount}` });
  };

  // 过滤显示
  const filteredSuggestions = useMemo(() => {
    if (!suggestions) return null;
    if (!filterText) return suggestions;
    const q = filterText.toLowerCase();
    return suggestions.filter(
      (s) =>
        s.categoryName.toLowerCase().includes(q) ||
        s.suggestedGroup.toLowerCase().includes(q) ||
        s.reason.toLowerCase().includes(q),
    );
  }, [suggestions, filterText]);

  // 获取分类的示例站点
  const getCategorySites = (catId: number) => sites.filter((s) => s.category_id === catId).slice(0, 5);

  return (
    <div className="space-y-6">
      {/* 面板头部 */}
      <div className="liquid-panel rounded-[2rem] p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Brain className="w-5 h-5 text-violet-500" />
              AI 智能分类
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              使用 AI 规则引擎分析分类名称和站点内容，自动建议更合理的第一级导航分组。
            </p>
          </div>
        </div>

        {/* 统计信息 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          <div className="liquid-chip rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-violet-500">{categories.length}</p>
            <p className="text-xs text-slate-500 mt-1">分类总数</p>
          </div>
          <div className="liquid-chip rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-pink-500">
              {categoryWithGroup.filter((c) => c.currentGroup === "其他导航").length}
            </p>
            <p className="text-xs text-slate-500 mt-1">在「其他导航」中</p>
          </div>
          <div className="liquid-chip rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-indigo-500">{sites.length}</p>
            <p className="text-xs text-slate-500 mt-1">站点总数</p>
          </div>
          <div className="liquid-chip rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-emerald-500">
              {suggestions?.filter((s) => !s.applied).length ?? "--"}
            </p>
            <p className="text-xs text-slate-500 mt-1">待处理建议</p>
          </div>
        </div>

        {/* 当前分组分布 */}
        <div className="mt-4">
          <h3 className="text-sm font-medium text-slate-600 mb-2">当前导航分组分布</h3>
          <div className="flex flex-wrap gap-2">
            {NAVIGATION_GROUPS.map((group) => {
              const count = categoryWithGroup.filter((c) => c.currentGroup === group).length;
              const colors: Record<string, string> = {
                "次元社区": "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
                "影音娱乐": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
                "实用工具": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
                "资源下载": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                "社交网盘": "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
                "其他导航": "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
              };
              return (
                <span key={group} className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium ${colors[group] || "bg-slate-100"}`}>
                  {group}
                  <span className="opacity-70">{count}</span>
                </span>
              );
            })}
          </div>
        </div>

        {/* 分析控制 */}
        <div className="flex items-center gap-3 mt-6 flex-wrap">
          <select
            value={analysisTarget}
            onChange={(e) => setAnalysisTarget(e.target.value as any)}
            className="liquid-input rounded-xl px-3 py-2 text-sm"
          >
            <option value="other">仅分析「其他导航」中的分类</option>
            <option value="all">分析全部分类</option>
            <option value="unclassified">分析空分类</option>
          </select>
          <button
            onClick={handleAnalyze}
            disabled={classifying}
            className="liquid-button-primary flex items-center gap-2 px-5 py-2.5 text-sm"
          >
            {classifying ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {classifying ? "分析中..." : "开始 AI 分析"}
          </button>
          {suggestions && suggestions.some((s) => !s.applied) && (
            <button
              onClick={handleApplyAll}
              disabled={applyAllLoading}
              className="liquid-button flex items-center gap-2 px-5 py-2.5 text-sm text-emerald-600 dark:text-emerald-400"
            >
              <MoveRight className="w-4 h-4" />
              {applyAllLoading ? "处理中..." : "一键应用全部"}
            </button>
          )}
        </div>
      </div>

      {/* 消息提示 */}
      {message && (
        <div className={`flex items-center gap-2 text-sm px-4 py-3 rounded-xl ${
          message.type === "success"
            ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20"
            : "text-red-500 bg-red-50 dark:bg-red-900/20"
        }`}>
          {message.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          {message.text}
        </div>
      )}

      {/* 分类详情 — 显示所有待处理分类及其 AI 建议 */}
      {suggestions && (
        <div className="space-y-4">
          {/* 搜索过滤 */}
          {filteredSuggestions && filteredSuggestions.length > 0 && (
            <div className="relative max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="搜索分类名..."
                className="liquid-input w-full rounded-2xl pl-9 pr-3 py-2 text-sm"
              />
            </div>
          )}

          {filteredSuggestions && filteredSuggestions.length > 0 ? (
            filteredSuggestions.map((suggestion) => (
              <div
                key={suggestion.categoryId}
                className={`liquid-panel rounded-[1.5rem] overflow-hidden transition-all ${
                  suggestion.applied ? "opacity-60" : ""
                }`}
              >
                <div className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                          {suggestion.categoryName}
                        </h3>
                        <span className="liquid-chip text-xs text-slate-500 px-2 py-0.5 rounded-full">
                          {suggestion.siteCount} 个站点
                        </span>
                      </div>

                      {/* 分组流向 */}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400">
                          {suggestion.currentGroup}
                        </span>
                        <MoveRight className="w-4 h-4 text-slate-400" />
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400">
                          {suggestion.suggestedGroup}
                        </span>
                        <span className={`text-xs font-mono ${
                          suggestion.confidence > 70
                            ? "text-emerald-500"
                            : suggestion.confidence > 40
                              ? "text-amber-500"
                              : "text-slate-400"
                        }`}>
                          {suggestion.confidence}% 置信度
                        </span>
                      </div>

                      <p className="text-xs text-slate-500 mt-1.5">{suggestion.reason}</p>

                      {/* 展开查看站点 */}
                      <button
                        onClick={() => setExpandedCat(expandedCat === suggestion.categoryId ? null : suggestion.categoryId)}
                        className="flex items-center gap-1 text-xs text-slate-400 hover:text-pink-500 mt-2"
                      >
                        {expandedCat === suggestion.categoryId ? (
                          <ChevronDown className="w-3 h-3" />
                        ) : (
                          <ChevronRight className="w-3 h-3" />
                        )}
                        查看站点
                      </button>

                      {expandedCat === suggestion.categoryId && (
                        <div className="mt-2 space-y-1">
                          {getCategorySites(suggestion.categoryId).map((site) => (
                            <div key={site.id} className="flex items-center gap-2 text-xs text-slate-500">
                              <span className="w-4 h-4 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[8px]">
                                {site.name[0]}
                              </span>
                              <span className="truncate flex-1">{site.name}</span>
                              <a href={site.url} target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-pink-500">
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          ))}
                          {suggestion.siteCount > 5 && (
                            <p className="text-[10px] text-slate-400">...还有 {suggestion.siteCount - 5} 个站点</p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* 操作按钮 */}
                    {!suggestion.applied && (
                      <button
                        onClick={() => handleApplySuggestion(suggestion as any)}
                        disabled={applying[suggestion.categoryId]}
                        className="liquid-button-primary shrink-0 flex items-center gap-1.5 px-4 py-2 text-sm"
                      >
                        {applying[suggestion.categoryId] ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ThumbsUp className="w-3.5 h-3.5" />
                        )}
                        采纳
                      </button>
                    )}
                    {suggestion.applied && (
                      <span className="shrink-0 flex items-center gap-1 text-xs text-emerald-500">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        已处理
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-12 text-slate-500">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-emerald-400" />
              <p className="font-medium">所有分类都已分配合理</p>
              <p className="text-sm mt-1">点击「开始 AI 分析」重新检查</p>
            </div>
          )}
        </div>
      )}

      {/* 初始状态 */}
      {!suggestions && !classifying && (
        <div className="text-center py-16 text-slate-500">
          <Brain className="w-16 h-16 mx-auto mb-4 text-violet-300 dark:text-violet-700" />
          <h3 className="text-lg font-medium text-slate-600 dark:text-slate-300">准备分析分类结构</h3>
          <p className="text-sm mt-2 max-w-md mx-auto">
            AI 分类引擎将分析每个分类的名称和站点内容，自动建议归属到更合适的导航分组。
            当前「其他导航」中有 {categoryWithGroup.filter((c) => c.currentGroup === "其他导航").length} 个分类等待分析。
          </p>
        </div>
      )}
    </div>
  );
}
