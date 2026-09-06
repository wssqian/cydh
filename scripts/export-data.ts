/**
 * scripts/export-data.ts — CLI 数据导出（bundle v2）
 *
 * 用法：
 *   npm run data:export                          # 导出到 data-export/guga-data-<ts>.tar.gz
 *   npm run data:export -- --include-secrets     # 含敏感设置（默认脱敏）
 *   npm run data:export -- --out ./my-backups
 */

import { exportBundle } from '../server/data-portable.js';

async function main() {
  const args = process.argv.slice(2);
  const includeSecrets = args.includes('--include-secrets');
  const outIdx = args.indexOf('--out');
  const outDir = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : undefined;

  console.log(`[data:export] 导出 bundle ${includeSecrets ? '(含敏感设置)' : '(敏感设置已脱敏)'}...`);
  const result = await exportBundle({ includeSecrets, outDir });

  console.log('导出完成:');
  console.log(`  文件:   ${result.filePath}`);
  console.log(`  时间:   ${result.manifest.exportedAt}`);
  console.log(`  脱敏:   ${result.manifest.secretsRedacted}`);
  console.log(`  图标:   ${result.manifest.icons} 个`);
  console.log(`  缓存:   ${result.manifest.acgCache} 个`);
  console.log('  表行数:');
  for (const [table, count] of Object.entries(result.manifest.tables)) {
    console.log(`    ${table}: ${count}`);
  }
}

main().catch((e) => {
  console.error(`[data:export] 失败: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
