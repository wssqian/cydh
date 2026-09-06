import { X, Save, RotateCcw, Flame, BookOpen, ChevronLeft, ChevronRight, Search, Compass, LayoutGrid, CloudSun, Moon, Image, Sparkles, Zap, Map, Palette, Clock } from "lucide-react";
import { useState, useEffect } from "react";
import {
  isHapticEnabled,
  setHapticEnabled,
} from "../utils/haptic";
import {
  applyBackgroundPreference,
  BACKGROUND_STORAGE_KEY,
  DEFAULT_BACKGROUND_URL,
  normalizeBackgroundPreference,
  resetBackgroundPreference,
  saveBackgroundPreference,
} from "../background-settings";
import {
  UI_THEME_CLASSIC,
  UI_THEME_IOS_PROFESSIONAL,
  type UiTheme,
} from "../ui-theme";
import {
  isSearchHistoryEnabled,
  setSearchHistoryEnabled,
} from "../search-history";

// 可用的热点平台列表
const AVAILABLE_PLATFORMS = [
  { id: 'bilibili', name: 'B站', emoji: '📺' },
  { id: 'weibo', name: '微博', emoji: '💬' },
  { id: 'zhihu', name: '知乎', emoji: '❓' },
  { id: 'douyin', name: '抖音', emoji: '🎵' },
  { id: 'toutiao', name: '今日头条', emoji: '📰' },
  { id: 'baidu', name: '百度', emoji: '🔍' },
  { id: 'qq-news', name: 'QQ新闻', emoji: '📋' },
  { id: 'sina-news', name: '新浪新闻', emoji: '📰' },
];

// 存储key
const HOT_PLATFORMS_STORAGE_KEY = "selectedHotPlatforms";

const UI_THEME_OPTIONS: Array<{ id: UiTheme; label: string; description: string }> = [
  { id: UI_THEME_CLASSIC, label: "经典液态", description: "柔和玻璃与粉色强调" },
  { id: UI_THEME_IOS_PROFESSIONAL, label: "iOS 专业工具", description: "克制玻璃与系统蓝绿" },
];

// 教程步骤
const TUTORIAL_STEPS = [
  {
    icon: Search,
    title: "搜索模式",
    accent: "from-pink-500 to-rose-500",
    description: "打开网站默认进入搜索模式。顶部有搜索框和多个搜索分类标签：站内、搜索、动漫、下载、漫画等。",
    tip: "输入关键词后按回车或点击搜索按钮即可跳转到对应搜索引擎的结果页。",
  },
  {
    icon: Compass,
    title: "切换到导航模式",
    accent: "from-violet-500 to-purple-500",
    description: "点击搜索框旁的「探索」按钮（指南针图标），即可切换到导航模式，浏览网站收录的全部资源分类。",
    tip: "导航模式下再次点击「返回导航」按钮可切回搜索模式。",
  },
  {
    icon: Zap,
    title: "多引擎搜索",
    accent: "from-amber-500 to-orange-500",
    description: "搜索模式下，选择不同的搜索标签后，下方还会显示该分类下的具体搜索引擎切换按钮，如百度、Google、Bing 等。",
    tip: "动漫标签下有次元城、AGE动漫、哔哩哔哩等动漫专用搜索引擎，搜索结果各不相同，可以多试试。",
  },
  {
    icon: LayoutGrid,
    title: "分类浏览资源",
    accent: "from-emerald-500 to-teal-500",
    description: "导航模式下，首页按分类展示所有收录的资源卡片。点击卡片即可跳转到对应网站。左侧边栏可以按分类快速定位。",
    tip: "在宽屏设备上，侧边栏会自动展开显示所有分类；收起侧边栏后点击左上角菜单按钮可以重新展开。",
  },
  {
    icon: Flame,
    title: "热点资讯",
    accent: "from-red-500 to-pink-500",
    description: "搜索模式下方会展示各平台的实时热点内容，支持 B站、微博、知乎、抖音、头条等多个平台。",
    tip: "在设置中可以自定义显示哪些热点平台。热点区域支持卡片视图和番剧日历视图切换。",
  },
  {
    icon: CloudSun,
    title: "天气信息",
    accent: "from-sky-500 to-blue-500",
    description: "页面顶部会根据你的位置自动显示当前天气信息，包括温度、天气状况和城市名称。点击设置图标可手动指定城市。",
    tip: "天气数据在页面空闲时加载，不影响首屏加载速度。VPN 用户可手动指定城市获取准确天气。",
  },
  {
    icon: Moon,
    title: "深浅主题",
    accent: "from-indigo-500 to-blue-500",
    description: "点击右下角的太阳/月亮图标，可以在浅色和深色主题之间切换，保护你的眼睛。",
    tip: "主题选择会自动保存，下次访问时会记住你的偏好。",
  },
  {
    icon: Image,
    title: "自定义背景",
    accent: "from-fuchsia-500 to-pink-500",
    description: "在本设置页面的「自定义背景图片 URL」中输入图片链接，即可更换网站背景。留空则使用每日自动更换的默认壁纸。",
    tip: "支持任意图片 URL，推荐使用高清横屏壁纸效果最佳。",
  },
  {
    icon: Map,
    title: "开始探索吧！",
    accent: "from-pink-500 to-rose-500",
    description: "以上就是本站的主要功能介绍。记住，搜索模式适合快速查找，导航模式适合慢慢浏览发现。",
    tip: "右下角的向上箭头按钮可以一键回到页面顶部。收藏本站到书签，下次访问更方便！",
  },
] as const;

function loadSelectedPlatforms(): string[] {
  try {
    const saved = localStorage.getItem(HOT_PLATFORMS_STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // Ignore errors
  }
  // 默认选中热门平台
  return ['bilibili', 'weibo', 'zhihu', 'douyin', 'toutiao'];
}

function saveSelectedPlatforms(platforms: string[]): void {
  try {
    localStorage.setItem(HOT_PLATFORMS_STORAGE_KEY, JSON.stringify(platforms));
  } catch {
    // Ignore errors
  }
}

interface SettingsModalProps {
  onClose: () => void;
  communityUnlocked: boolean;
  /** 提交口令到服务端解锁；成功 true、失败 false */
  onCommunityUnlock: (password: string) => Promise<boolean>;
  /** 主动登出当前社区会话 */
  onCommunityLogout: () => Promise<void>;
  uiThemePreference: UiTheme;
  onUiThemeChange: (theme: UiTheme) => Promise<UiTheme>;
}

export default function SettingsModal({
  onClose,
  communityUnlocked,
  onCommunityUnlock,
  onCommunityLogout,
  uiThemePreference,
  onUiThemeChange,
}: SettingsModalProps) {
  const [bgUrl, setBgUrl] = useState("");
  const [communityCode, setCommunityCode] = useState("");
  const [communityFeedback, setCommunityFeedback] = useState("");
  const [submittingCommunity, setSubmittingCommunity] = useState(false);
  const [selectedUiTheme, setSelectedUiTheme] = useState<UiTheme>(uiThemePreference);
  const [themeError, setThemeError] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(loadSelectedPlatforms);
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [historyEnabled, setHistoryEnabled] = useState(() => isSearchHistoryEnabled());

  useEffect(() => {
    const savedBg = localStorage.getItem(BACKGROUND_STORAGE_KEY);
    if (savedBg) {
      setBgUrl(normalizeBackgroundPreference(savedBg) || "");
    }
  }, []);

  useEffect(() => {
    setSelectedUiTheme(uiThemePreference);
  }, [uiThemePreference]);

  const handleSave = async () => {
    setSavingSettings(true);
    setThemeError("");
    try {
      if (selectedUiTheme !== uiThemePreference) {
        await onUiThemeChange(selectedUiTheme);
      }
    } catch {
      setThemeError("界面主题加载失败，请稍后重试。");
      setSavingSettings(false);
      return;
    }

    if (bgUrl.trim()) {
      const normalizedBackground = saveBackgroundPreference(bgUrl);
      if (normalizedBackground) {
        applyBackgroundPreference(normalizedBackground);
      }
    } else {
      applyBackgroundPreference(resetBackgroundPreference());
    }
    saveSelectedPlatforms(selectedPlatforms);
  // 触发自定义事件通知其他组件
    window.dispatchEvent(new CustomEvent('hotPlatformsChanged'));
    setSavingSettings(false);
    onClose();
  };

  const handleReset = async () => {
    setSavingSettings(true);
    setThemeError("");
    try {
      await onUiThemeChange(UI_THEME_CLASSIC);
    } catch {
      setThemeError("界面主题恢复失败，请稍后重试。");
      setSavingSettings(false);
      return;
    }
    applyBackgroundPreference(resetBackgroundPreference());
    setBgUrl("");
    setSelectedPlatforms(['bilibili', 'weibo', 'zhihu', 'douyin', 'toutiao']);
    saveSelectedPlatforms(['bilibili', 'weibo', 'zhihu', 'douyin', 'toutiao']);
    setSavingSettings(false);
    onClose();
  };

  const togglePlatform = (platformId: string) => {
    setSelectedPlatforms(prev => {
      if (prev.includes(platformId)) {
        return prev.filter(id => id !== platformId);
      } else {
        return [...prev, platformId];
      }
    });
  };

  const submitCommunityCode = async () => {
    const value = communityCode;
    if (communityUnlocked) {
      // 已解锁状态下“输入其他内容并回车”意味着主动登出/重新隐藏
      await onCommunityLogout();
      setCommunityFeedback("已登出，次元社区重新隐藏。");
      setCommunityCode("");
      return;
    }
    setSubmittingCommunity(true);
    setCommunityFeedback("");
    const ok = await onCommunityUnlock(value);
    setSubmittingCommunity(false);
    setCommunityCode("");
    setCommunityFeedback(ok ? "已解锁，次元社区已显示。" : "口令不正确，次元社区保持隐藏。");
  };

  const currentStep = TUTORIAL_STEPS[tutorialStep];
  const StepIcon = currentStep.icon;

  return (
    <div className="liquid-overlay fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="liquid-panel w-full max-w-md rounded-[2rem] overflow-hidden animate-in fade-in zoom-in-95 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/30 dark:border-white/10 shrink-0 bg-[var(--liquid-surface-strong)] backdrop-blur-xl">
           <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
             {showTutorial ? "使用教程" : "个性化设置"}
           </h2>
           <button onClick={showTutorial ? () => setShowTutorial(false) : onClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
             <X className="w-5 h-5" />
           </button>
        </div>

        {showTutorial ? (
          <div className="p-6 overflow-y-auto flex-1 min-h-0">
            {/* 教程步骤内容 */}
            <div className="mb-6 text-center">
              <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${currentStep.accent} text-white shadow-lg`}>
                <StepIcon className="h-8 w-8" />
              </div>
              <div className="mb-2 text-xs font-medium text-slate-400">
                {tutorialStep + 1} / {TUTORIAL_STEPS.length}
              </div>
              <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-3">
                {currentStep.title}
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
                {currentStep.description}
              </p>
              <div className="liquid-chip rounded-2xl px-4 py-3 text-left">
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  <span className="font-semibold text-pink-500">Tips: </span>
                  {currentStep.tip}
                </p>
              </div>
            </div>

            {/* 进度指示点 */}
            <div className="flex justify-center gap-1.5 mb-6">
              {TUTORIAL_STEPS.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setTutorialStep(i)}
                  className={`h-1.5 rounded-full transition-all ${
                    i === tutorialStep
                      ? "w-6 bg-pink-500"
                      : "w-1.5 bg-slate-300 dark:bg-slate-600 hover:bg-pink-300"
                  }`}
                  aria-label={`Step ${i + 1}`}
                />
              ))}
            </div>

            {/* 导航按钮 */}
            <div className="flex items-center justify-between gap-3">
              {tutorialStep > 0 ? (
                <button
                  onClick={() => setTutorialStep((s) => s - 1)}
                  className="liquid-button flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>上一步</span>
                </button>
              ) : (
                <button
                  onClick={() => setShowTutorial(false)}
                  className="liquid-button flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300"
                >
                  <span>返回设置</span>
                </button>
              )}

              {tutorialStep < TUTORIAL_STEPS.length - 1 ? (
                <button
                  onClick={() => setTutorialStep((s) => s + 1)}
                  className="liquid-button-primary flex items-center gap-1.5 px-5 py-2 text-sm font-medium"
                >
                  <span>下一步</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={() => setShowTutorial(false)}
                  className="liquid-button-primary flex items-center gap-1.5 px-5 py-2 text-sm font-medium"
                >
                  <span>开始探索</span>
                  <Sparkles className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        ) : (
        <div className="p-6 overflow-y-auto flex-1 min-h-0">
           <button
             onClick={() => { setShowTutorial(true); setTutorialStep(0); }}
             className="liquid-chip w-full flex items-center gap-3 rounded-2xl px-4 py-3 mb-6 text-sm font-medium text-slate-700 dark:text-slate-300 hover:ring-2 hover:ring-pink-500 transition-all"
           >
             <BookOpen className="w-5 h-5 text-pink-500" />
             <span>使用教程</span>
             <span className="ml-auto text-xs text-slate-400">了解本站功能</span>
             <ChevronRight className="w-4 h-4 text-slate-400" />
           </button>

           <div className="mb-6">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                <Palette className="w-4 h-4 text-pink-500" />
                界面风格
              </label>
              <div className="liquid-chip grid grid-cols-2 gap-1 rounded-2xl p-1">
                {UI_THEME_OPTIONS.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    data-ui-theme-option={theme.id}
                    onClick={() => setSelectedUiTheme(theme.id)}
                    className={`rounded-xl px-3 py-2.5 text-left transition-all ${
                      selectedUiTheme === theme.id
                        ? "bg-white/75 text-slate-900 shadow-sm ring-2 ring-pink-500 dark:bg-white/15 dark:text-slate-100"
                        : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  >
                    <span className="block text-sm font-semibold">{theme.label}</span>
                    <span className="mt-0.5 block text-[11px] font-normal opacity-70">{theme.description}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                iOS 专业工具主题只会在选择或已保存时加载，不影响默认首屏资源。
              </p>
              {themeError && (
                <p className="mt-2 text-xs text-red-500">{themeError}</p>
              )}
           </div>

           <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                自定义背景图片 URL
              </label>
              <input
                type="text"
                value={bgUrl}
                onChange={(e) => setBgUrl(e.target.value)}
                placeholder={DEFAULT_BACKGROUND_URL}
                className="liquid-input w-full rounded-2xl px-4 py-3 text-sm dark:text-slate-200"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void handleSave();
                  }
                }}
              />
              <p className="mt-2 text-xs text-slate-500">留空或点击重置使用默认自动日更壁纸。</p>
           </div>

           <div className="mb-6">
              <label className="liquid-chip flex items-start gap-3 rounded-2xl px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={isHapticEnabled()}
                  onChange={(event) => setHapticEnabled(event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  启用触觉反馈
                  <span className="block mt-1 text-xs font-normal text-slate-500">
                    开启后切换标签、下拉刷新等操作时会有轻微的振动反馈。仅支持部分移动端设备。
                  </span>
                </span>
              </label>
           </div>

           {/* 搜索历史开关 */}
           <div className="mb-6">
              <label className="liquid-chip flex items-start gap-3 rounded-2xl px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={historyEnabled}
                  onChange={(event) => {
                    setHistoryEnabled(event.target.checked);
                    setSearchHistoryEnabled(event.target.checked);
                  }}
                  className="mt-0.5"
                />
                <span>
                  <span className="flex items-center gap-1.5">
                    <Clock className="inline-block h-3.5 w-3.5 text-pink-500" />
                    启用搜索历史记录
                  </span>
                  <span className="block mt-1 text-xs font-normal text-slate-500">
                    搜索历史仅保存在您的浏览器本地，不会上传到服务器。可在纯搜索模式下快速复用之前的搜索。默认关闭，首次搜索时会询问是否开启。
                  </span>
                </span>
              </label>
           </div>

           <div className="mb-6">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                <Flame className="w-4 h-4 text-orange-500" />
                显示的热点平台
              </label>
              <div className="grid grid-cols-2 gap-2">
                {AVAILABLE_PLATFORMS.map((platform) => (
                  <button
                    key={platform.id}
                    onClick={() => togglePlatform(platform.id)}
                    className={`liquid-chip flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm transition-all ${
                      selectedPlatforms.includes(platform.id)
                        ? 'ring-2 ring-pink-500 bg-pink-50 dark:bg-pink-900/20'
                        : 'opacity-60 hover:opacity-100'
                    }`}
                  >
                    <span>{platform.emoji}</span>
                    <span className="font-medium">{platform.name}</span>
                    {selectedPlatforms.includes(platform.id) && (
                      <span className="ml-auto text-pink-500">✓</span>
                    )}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                已选择 {selectedPlatforms.length} 个平台，首页将显示这些平台的热点内容
              </p>
           </div>

           <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                隐藏内容访问口令
              </label>
              <input
                type="password"
                value={communityCode}
                onChange={(event) => setCommunityCode(event.target.value)}
                placeholder="输入口令后按回车"
                autoComplete="off"
                disabled={submittingCommunity}
                className="liquid-input w-full rounded-2xl px-4 py-3 text-sm dark:text-slate-200"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submitCommunityCode();
                  }
                }}
              />
              <p className="mt-2 text-xs text-slate-500">
                {communityFeedback || (communityUnlocked ? "次元社区当前已显示；输入其他内容并回车可重新隐藏。" : "验证后才会显示次元社区导航内容。")}
              </p>
           </div>

           <div className="flex items-center justify-end gap-3 mt-8">
              <button
                onClick={() => { void handleReset(); }}
                disabled={savingSettings}
                className="liquid-button flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300"
              >
                <RotateCcw className="w-4 h-4" />
                <span>恢复默认</span>
              </button>
              <button
                onClick={() => { void handleSave(); }}
                disabled={savingSettings}
                className="liquid-button-primary flex items-center gap-2 px-5 py-2 text-sm font-medium"
              >
                <Save className="w-4 h-4" />
                <span>{savingSettings ? "保存中..." : "保存设置"}</span>
              </button>
           </div>
        </div>
        )}
      </div>
    </div>
  );
}
