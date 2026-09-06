/**
 * GitHub API 交互模块
 */

import nacl from 'tweetnacl';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { GitHubRelease, GitHubTag, UpdateChannel } from './types.js';

const GITHUB_OWNER = process.env.GITHUB_OWNER || 'wssqian';
const GITHUB_REPO = process.env.GITHUB_REPO || 'guga-';
const GITHUB_API_BASE = 'https://api.github.com';

function getGitHubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': `${GITHUB_REPO}-updater`,
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function fetchGitHubApi<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: getGitHubHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`GitHub API ${response.status}: ${response.statusText}`);
    }
    return (await response.json()) as T;
  } catch (error: any) {
    if (error.name === 'TimeoutError') {
      throw new Error('GitHub API 请求超时');
    }
    throw error;
  }
}

export async function fetchLatestRelease(channel: UpdateChannel): Promise<GitHubRelease | null> {
  if (channel === 'nightly') return null;
  
  const url = channel === 'stable'
    ? `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
    : `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
  
  const data = await fetchGitHubApi<GitHubRelease | GitHubRelease[]>(url);
  
  if (!data) return null;
  
  if (Array.isArray(data)) {
    return data[0] || null;
  }
  
  if (channel === 'stable' && data.prerelease) {
    return null;
  }
  
  return data;
}

export async function fetchTags(): Promise<GitHubTag[]> {
  const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags?per_page=20`;
  const data = await fetchGitHubApi<GitHubTag[]>(url);
  return data || [];
}

export async function fetchReleaseAsset(assetUrl: string, destPath: string): Promise<void> {
  const { pipeline } = await import('node:stream/promises');
  const { createWriteStream } = await import('node:fs');

  const response = await fetch(assetUrl, {
    signal: AbortSignal.timeout(300_000),
    headers: getGitHubHeaders(),
  });

  if (!response.ok) {
    throw new Error(`下载失败: HTTP ${response.status}`);
  }

  if (!response.body) {
    throw new Error('下载响应为空');
  }

  await pipeline(response.body as any, createWriteStream(destPath));
}

export async function fetchSignatureAsset(signatureUrl: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(signatureUrl, {
      signal: AbortSignal.timeout(30_000),
      headers: getGitHubHeaders(),
    });
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch {
    return null;
  }
}

export function findDistAsset(release: GitHubRelease): GitHubRelease['assets'][0] | null {
  const standardAssets = [
    'dist.tar.gz',
    'dist.zip',
    `${GITHUB_REPO}-dist.tar.gz`,
    `${GITHUB_REPO}-dist.zip`,
  ];

  for (const name of standardAssets) {
    const asset = release.assets.find(a => a.name === name);
    if (asset) return asset;
  }

  const distAsset = release.assets.find(
    a => a.name.endsWith('-dist.tar.gz') || a.name.endsWith('-dist.zip') || a.name === 'dist.tar.gz' || a.name === 'dist.zip'
  );
  return distAsset || null;
}

export function findSignatureAsset(release: GitHubRelease, assetName: string): GitHubRelease['assets'][0] | null {
  const sigNames = [
    `${assetName}.sig`,
    `${assetName}.signature`,
    `${assetName.replace('.tar.gz', '')}.sig`,
    `${assetName.replace('.zip', '')}.sig`,
  ];

  for (const name of sigNames) {
    const asset = release.assets.find(a => a.name === name);
    if (asset) return asset;
  }

  return null;
}

export function verifyEd25519Signature(
  publicKeyBase64: string,
  data: Uint8Array,
  signatureBase64: string
): boolean {
  try {
    const publicKey = Uint8Array.from(atob(publicKeyBase64), c => c.charCodeAt(0));
    const signature = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0));
    
    if (publicKey.length !== 32 || signature.length !== 64) {
      return false;
    }
    
    return nacl.sign.detached.verify(data, signature, publicKey);
  } catch {
    return false;
  }
}

export async function verifyAssetSignature(
  publicKeyBase64: string,
  assetPath: string,
  signatureAsset: GitHubRelease['assets'][0] | null,
  signatureDataOverride?: Uint8Array | null
): Promise<boolean> {
  if (!signatureAsset) {
    return false;
  }

  let signatureData: Uint8Array | null;
  if (signatureDataOverride !== undefined) {
    // 测试注入路径：直接提供 sig 文件字节，跳过网络下载
    signatureData = signatureDataOverride;
  } else {
    signatureData = await fetchSignatureAsset(signatureAsset.browser_download_url);
  }
  if (!signatureData) {
    return false;
  }

  const assetData = readFileSync(assetPath);

  // .sig 资产内容已是 base64 文本（sign 脚本写入 base64 字符串），
  // 直接作为签名 base64 传给 verifyEd25519Signature（其内部 atob 解码为 64 字节）。
  const signatureBase64 = Buffer.from(signatureData).toString('utf8').trim();
  return verifyEd25519Signature(publicKeyBase64, assetData, signatureBase64);
}

export function computeSHA256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function computeFileSHA256(filePath: string): string {
  const data = readFileSync(filePath);
  return computeSHA256(data);
}

// Backward compatibility alias
export { fetchReleaseAsset as downloadFile };