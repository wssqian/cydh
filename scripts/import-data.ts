/**
 * scripts/import-data.ts — CLI 数据导入（bundle v2）
 *
 * 用法：
 *   npm run data:import -- <file.tar.gz>        # 直接导入（会先预览校验）
 *   npm run data:import -- --preview <file.tar.gz>  # 仅预览，不落库
 */

import { previewBundle, importBundle } from '../server/data-portable.js';

async function main() {
  const args = process.argv.slice(2);
  const previewOnly = args.includes('--preview');
  const fileArg = args.filter((a) => !a.startsWith('--'))[0];

  if (!fileArg) {
    console.error('用法: npm run data:import -- [--preview] <data.tar.gz>');
    process.exit(1);
  }

  console.log(`[data:import] ${previewOnly ? '预览' : '导入'} ${fileArg}...`);

  if (previewOnly) {
    const summary = await previewBundle(fileArg);
    console.log('预览结果:');
    console.log(`  版本:     ${summary.schemaVersion}`);
    console.log(`  导出时间: ${summary.exportedAt}`);
    console.log(`  脱敏:     ${summary.secretsRedacted}`);
    console.log(`  完整性:   ${summary.integrityOk ? '通过' : '失败'}`);
    if (!summary.integrityOk) {
      for (const err of summary.integrityErrors) console.log(`    ✗ ${err}`);
    }
    console.log(`  图标:     ${summary.icons} 个`);
    console.log(`  缓存:     ${summary.acgCache} 个`);
    console.log('  表行数:');
    for (const [table, count] of Object.entries(summary.tables)) {
      console.log(`    ${table}: ${count}`);
    }
    return;
  }

  // 预览确认后导入
  const summary = await previewBundle(fileArg);
  if (!summary.integrityOk) {
    console.error('完整性校验失败，拒绝导入:');
    for (const err of summary.integrityErrors) console.error(`  ✗ ${err}`);
    process.exit(1);
  }
  if (summary.secretsRedacted) {
    console.log('提示: bundle 中敏感设置已脱敏，导入后需在管理页补填密钥。');
  }

  console.log('开始导入（导入前会自动备份当前数据库）...');
  const result = await importBundle(fileArg);
  console.log(`导入结果: ${result.success ? '成功' : '部分失败'}`);
  console.log(`  预导入备份: ${result.preImportBackup}`);
  console.log(`  导入表:     ${result.tablesImported}`);
  console.log(`  图标:       ${result.iconsImported} 个`);
  console.log(`  缓存:       ${result.acgCacheImported} 个`);
  if (result.errors.length > 0) {
    for (const err of result.errors) console.error(`  ✗ ${err}`);
  }
  if (!result.success) process.exit(1);
}

main().catch((e) => {
  console.error(`[data:import] 失败: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
