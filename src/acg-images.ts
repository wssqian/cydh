function toProxyImageUrl(endpoint: string, url: string | null | undefined) {
  if (!url) return "";
  return `${endpoint}?url=${encodeURIComponent(url)}`;
}

export function toBangumiCoverUrl(url: string | null | undefined) {
  return toProxyImageUrl("/api/public/bangumi-cover", url);
}

export function toMangaCoverUrl(url: string | null | undefined) {
  return toProxyImageUrl("/api/public/manga-cover", url);
}

export function toGalCoverUrl(url: string | null | undefined) {
  return toProxyImageUrl("/api/public/gal-cover", url);
}

export function toPixivImageUrl(url: string | null | undefined) {
  return toProxyImageUrl("/api/public/pixiv-image", url);
}

/**
 * 生成适合用户操作系统的命令行下载指令文本。
 * 用户在自己终端执行即可拉取直链，规避浏览器跨域/网络问题。
 */
export function buildDownloadCommand(url: string, filename: string): { command: string; label: string } {
  const ext = url.match(/\.(jpe?g|png|gif|webp)(?:[?#]|$)/i)?.[1].toLowerCase().replace("jpeg", "jpg") || "jpg";
  const isWindows = typeof navigator !== "undefined" && /win/i.test(navigator.platform);
  if (isWindows) {
    return {
      command: `Invoke-WebRequest -Uri "${url}" -OutFile "${filename}.${ext}"`,
      label: "PowerShell 下载命令",
    };
  }
  return { command: `wget ${url}`, label: "wget 下载命令" };
}

/**
 * 通过 fetch -> Blob -> object URL 触发浏览器下载。
 *
 * 服务端派发的 Worker / CF CDN 直链（或本站 302 派发入口）均返
 * Access-Control-Allow-Origin: *，让 mode:"cors" 的 fetch 能读到 blob，
 * 全程不连 i.pximg.net、不消耗本服务器出站带宽。
 *
 * @param url 已可直接 fetch 的图片 URL
 * @param filename 落盘文件名（不含扩展名，函数按 Content-Type 或 URL 扩展名补全）
 * @throws fetch 失败、响应非 OK、或响应体为空时抛出错误
 */
export async function downloadImageAsFile(url: string, filename: string): Promise<void> {
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) {
    throw new Error(`下载失败：服务器返回 ${response.status}`);
  }

  const blob = await response.blob();
  if (blob.size === 0) {
    throw new Error("下载失败：图片内容为空");
  }

  // 扩展名优先取 blob MIME（原图可能为 PNG 即使 URL 推断为 .jpg），回退 URL 路径，最终 .jpg
  const MIME_EXT: Record<string, string> = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp",
  };
  let ext = MIME_EXT[blob.type];
  if (!ext) {
    const m = url.match(/\.(jpe?g|png|gif|webp)(?:[?#]|$)/i);
    ext = m ? `.${m[1].toLowerCase().replace("jpeg", "jpg")}` : ".jpg";
  }
  const downloadName = /\.[a-z0-9]{2,4}$/i.test(filename) ? filename : `${filename}${ext}`;

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = downloadName;
  anchor.style.display = "none";

  try {
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    document.body.removeChild(anchor);
    // 延迟释放 object URL，确保浏览器已开始下载
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}
