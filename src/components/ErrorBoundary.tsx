import React from "react";
import { AlertTriangle, RotateCw, Home } from "lucide-react";

interface ErrorBoundaryState {
  hasError: boolean;
}

interface ErrorBoundaryProps {
  /** 值变化时清除错误状态并重新渲染子树（典型用于 location 变化时重试）。 */
  resetKeys?: unknown[];
  children: React.ReactNode;
}

/**
 * ErrorBoundary — 顶层降级兜底组件
 *
 * React 组件树在渲染、生命周期或构造函数中抛出未捕获异常时，整页会白屏。
 * 本组件捕获这类异常并展示可重试的降级 UI，避免用户面对空白界面。
 * 未捕获事件回调、异步错误与订阅错误，这些仍需在各处自行 try/catch。
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKeys !== this.props.resetKeys) {
      this.setState({ hasError: false });
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.assign("/");
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm p-6">
        <div className="glass-card max-w-md w-full p-6 sm:p-8 rounded-3xl text-center text-slate-700 dark:text-slate-200">
          <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-amber-500" />
          <h1 className="text-lg sm:text-xl font-bold mb-2">应用发生异常</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
            页面出现了一个问题，你可以刷新当前页面，或返回首页继续浏览。
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 liquid-button glass-hover px-5 py-2.5 rounded-full text-sm font-medium"
            >
              <RotateCw className="w-4 h-4" />
              刷新页面
            </button>
            <button
              onClick={this.handleGoHome}
              className="inline-flex items-center gap-2 liquid-button glass-hover px-5 py-2.5 rounded-full text-sm font-medium"
            >
              <Home className="w-4 h-4" />
              返回首页
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
