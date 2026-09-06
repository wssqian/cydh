/**
 * ACG 特色功能统一提示横幅
 * 当用户网络环境无法访问境外资源时显示
 */
export function AcgNotice() {
  return (
    <div className="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 text-xs">
        <span className="shrink-0">{"⚠️"}</span>
        <span>本功能数据来自海外 API，需要特殊网络环境。如加载失败请检查网络代理设置。</span>
      </div>
    </div>
  );
}
