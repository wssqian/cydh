/**
 * 版本比较与通道过滤模块
 */

import { compare as semverCompare, parse as semverParse, clean as semverClean, valid as semverValid } from 'semver';
import type { UpdateChannel, GitHubRelease, GitHubTag } from './types.js';

export function normalizeVersion(version: string): string {
  return version.replace(/^[vV]/, '').trim();
}

export function parseVersion(version: string) {
  const cleaned = semverClean(version, { loose: true });
  if (!cleaned) return null;
  return semverParse(cleaned, { loose: true });
}

export function isValidVersion(version: string): boolean {
  return semverValid(normalizeVersion(version), { loose: true }) !== null;
}

export function compareVersions(a: string, b: string): number {
  const na = normalizeVersion(a);
  const nb = normalizeVersion(b);
  return semverCompare(na, nb, { loose: true });
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}

export function filterReleasesByChannel(releases: GitHubRelease[], channel: UpdateChannel): GitHubRelease[] {
  switch (channel) {
    case 'stable':
      return releases.filter(r => !r.prerelease);
    case 'beta':
      return releases; // Include all releases
    case 'nightly':
      return []; // Nightly uses tags, not releases
    default:
      return releases.filter(r => !r.prerelease);
  }
}

export function getLatestVersionFromReleases(releases: GitHubRelease[], channel: UpdateChannel): string | null {
  const filtered = filterReleasesByChannel(releases, channel);
  if (filtered.length === 0) return null;
  
  // Sort by version (newest first)
  filtered.sort((a, b) => compareVersions(b.tag_name, a.tag_name));
  return filtered[0].tag_name;
}

export function getLatestVersionFromTags(tags: GitHubTag[]): string | null {
  if (tags.length === 0) return null;
  
  // Sort by commit date (would need commit info, fallback to version comparison)
  const validTags = tags
    .map(t => normalizeVersion(t.name))
    .filter(v => isValidVersion(v))
    .sort((a, b) => compareVersions(b, a));
  
  return validTags[0] || null;
}

export function getChannelDisplayName(channel: UpdateChannel): string {
  switch (channel) {
    case 'stable': return '稳定版';
    case 'beta': return '预发布版';
    case 'nightly': return '夜ly构建';
    default: return '未知';
  }
}

export function getChannelDescription(channel: UpdateChannel): string {
  switch (channel) {
    case 'stable': return '生产环境推荐，仅正式版本';
    case 'beta': return '内测/预生产环境，包含预发布版本';
    case 'nightly': return '开发/CI环境，最新提交标签';
    default: return '';
  }
}

export function getAllChannels(): { value: UpdateChannel; label: string; description: string }[] {
  return [
    { value: 'stable', label: '稳定版', description: '生产环境推荐，仅正式版本' },
    { value: 'beta', label: '预发布版', description: '内测/预生产环境，包含预发布版本' },
    { value: 'nightly', label: '夜ly构建', description: '开发/CI环境，最新提交标签' },
  ];
}