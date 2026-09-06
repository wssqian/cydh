#!/usr/bin/env node

/**
 * ACGBox 爬取功能测试脚本
 * 用于验证爬取逻辑是否正常工作
 */

import { scrapeACGBoxHotContent } from '../server/acgbox-scraper.js';
import type { ACGBoxScraperConfig } from '../server/acgbox-scraper-settings.js';

const testConfig: ACGBoxScraperConfig = {
  enabled: true,
  intervalHours: 1,
  proxyEnabled: false,
  proxyUrl: undefined,
  maxConcurrent: 2,
  timeoutMs: 30000,
  retryCount: 2,
};

async function testScraping() {
  console.log('🧪 开始测试 ACGBox 爬取功能...\n');
  console.log('配置:');
  console.log(`  - 超时: ${testConfig.timeoutMs}ms`);
  console.log(`  - 重试: ${testConfig.retryCount}次`);
  console.log(`  - 并发: ${testConfig.maxConcurrent}`);
  console.log('');

  try {
    console.log('📡 正在爬取 ACGBox 热门内容...\n');
    const startTime = Date.now();

    const result = await scrapeACGBoxHotContent(testConfig);

    const duration = Date.now() - startTime;

    console.log('\n✅ 爬取完成！');
    console.log(`\n📊 结果统计:`);
    console.log(`  - 耗时: ${(duration / 1000).toFixed(2)}秒`);
    console.log(`  - 处理页面: ${result.pagesProcessed}/2`);
    console.log(`  - 热门榜数量: ${result.rankingsCount}`);
    console.log(`  - 平台热点数量: ${result.highlightsCount}`);
    console.log(`  - 错误数量: ${result.errors.length}`);

    if (result.errors.length > 0) {
      console.log(`\n⚠️  错误详情:`);
      result.errors.forEach((err, i) => {
        console.log(`  ${i + 1}. ${err}`);
      });
    }

    if (result.rankings.length > 0) {
      console.log(`\n🏆 热门榜前5名:`);
      result.rankings.slice(0, 5).forEach((ranking, i) => {
        console.log(`  ${i + 1}. ${ranking.title}`);
        console.log(`     URL: ${ranking.url}`);
        console.log(`     平台: ${ranking.platform || '未知'}`);
        console.log(`     分类: ${ranking.category || '未知'}`);
        if (ranking.hotScore) {
          console.log(`     热度: ${ranking.hotScore}`);
        }
        console.log('');
      });
    }

    if (result.highlights.length > 0) {
      console.log(`\n🔥 平台热点前5名:`);
      result.highlights.slice(0, 5).forEach((highlight, i) => {
        console.log(`  ${i + 1}. [${highlight.platform}] ${highlight.title}`);
        console.log(`     URL: ${highlight.url}`);
        if (highlight.hotValue) {
          console.log(`     热度值: ${highlight.hotValue}`);
        }
        console.log('');
      });
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    if (result.rankingsCount > 0 || result.highlightsCount > 0) {
      console.log('🎉 测试成功！爬取功能正常工作。');
      console.log(`\n共获取 ${result.rankingsCount} 条热门榜和 ${result.highlightsCount} 条平台热点。`);
    } else {
      console.log('⚠️  警告：成功爬取但未获取到任何数据。');
      console.log('可能原因：');
      console.log('  1. ACGBox网站结构已更改');
      console.log('  2. 页面内容无法识别');
      console.log('  3. 网络请求返回空内容');
      console.log('\n建议：');
      console.log('  - 检查 https://www.acgbox.link/yingyinzhuanqu 是否可访问');
      console.log('  - 查看服务器日志获取详细信息');
    }
    console.log('='.repeat(50));

    return result;
  } catch (error) {
    console.error('\n❌ 测试失败！');
    console.error(`\n错误信息: ${error instanceof Error ? error.message : String(error)}`);

    if (error instanceof Error && error.stack) {
      console.error('\n错误堆栈:');
      console.error(error.stack);
    }

    console.log('\n🔍 故障排除建议:');
    console.log('  1. 检查网络连接');
    console.log('  2. 验证 ACGBox 网站是否可访问');
    console.log('  3. 检查代理设置（如果使用代理）');
    console.log('  4. 查看服务器日志获取更多信息');

    throw error;
  }
}

// Run test
testScraping()
  .then(() => {
    console.log('\n✨ 测试完成');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 测试异常终止');
    process.exit(1);
  });
