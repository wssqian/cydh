import { ArrowUp, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import {
  readColorModePreference,
  saveColorModePreference,
} from "../ui-theme";

/**
 * FloatingTools — 自适应浮动操作按钮
 *
 * 桌面端 (≥1024px)：右下角纵向排列
 * 移动端 (<1024px)：底部导航栏上方横向排列
 *
 * 定位逻辑由 CSS 中的 `--mobile-fab-*` 变量和 @media 控制。
 */
export function FloatingTools() {
  const [isVisible, setIsVisible] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsDark(readColorModePreference() === "dark");
    setIsMobile(window.innerWidth < 1024);

    const handleResize = () => setIsMobile(window.innerWidth < 1024);

    const toggleVisibility = () => {
      setIsVisible(window.pageYOffset > 300);
    };

    window.addEventListener("scroll", toggleVisibility);
    window.addEventListener("resize", handleResize);

    // Initial checks
    toggleVisibility();

    return () => {
      window.removeEventListener("scroll", toggleVisibility);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleTheme = () => {
    const nextMode = isDark ? "light" : "dark";
    saveColorModePreference(nextMode);
    setIsDark(nextMode === "dark");
  };

  return (
    <div
      className={`floating-tools ${isMobile ? "floating-tools-mobile" : ""}`}
    >
      {/* 回到顶部（桌面端：滚动后出现；移动端：始终可见） */}
      {(isMobile || isVisible) && (
        <button
          onClick={scrollToTop}
          className={`floating-tool-btn ${isMobile ? "" : "animate-in fade-in slide-in-from-bottom-4"}`}
          aria-label="回到顶部"
          title="回到顶部"
        >
          <ArrowUp className="floating-tool-icon" />
        </button>
      )}

      {/* 主题切换 */}
      <button
        onClick={toggleTheme}
        className="floating-tool-btn"
        aria-label="切换主题"
        title={isDark ? "切换到白天模式" : "切换到黑夜模式"}
      >
        {isDark ? <Sun className="floating-tool-icon" /> : <Moon className="floating-tool-icon" />}
      </button>
    </div>
  );
}
