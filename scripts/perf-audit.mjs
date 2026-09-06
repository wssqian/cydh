#!/usr/bin/env node
/**
 * Performance audit script — checks key performance indicators in the codebase.
 * Run: node scripts/perf-audit.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { globSync } from 'fs';
import path from 'path';

const SRC_DIR = path.resolve('src');
const issues = [];
let passed = 0;
let failed = 0;

function check(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    issues.push(message);
  }
}

// 1. Check for shared IntersectionObserver usage
const scrollRevealContent = readFileSync(path.join(SRC_DIR, 'hooks/useScrollReveal.ts'), 'utf-8');
check(
  scrollRevealContent.includes('observeReveal'),
  'useScrollReveal should use shared observeReveal from lib/intersection-observer'
);

// 2. Check 3D card tilt is CSS-only
const tiltContent = readFileSync(path.join(SRC_DIR, 'hooks/use3DCardTilt.ts'), 'utf-8');
check(
  !tiltContent.includes('onPointerMove'),
  'use3DCardTilt should NOT have onPointerMove handler (CSS-only)'
);

// 3. Check ResourceCard doesn't have onPointerMove
const cardContent = readFileSync(path.join(SRC_DIR, 'components/ResourceCard.tsx'), 'utf-8');
check(
  !cardContent.includes('onPointerMove'),
  'ResourceCard should NOT have onPointerMove (use CSS-only tilt)'
);

// 4. Check CSS for hue-rotate removal
const cssContent = readFileSync(path.join(SRC_DIR, 'index.css'), 'utf-8');
check(
  !cssContent.includes('hue-rotate'),
  'CSS should not use hue-rotate (expensive filter)'
);

// 5. Check CSS for filter:brightness removal
check(
  !cssContent.includes('filter: brightness'),
  'CSS should not use filter:brightness on hover (use opacity instead)'
);

// 6. Check index.html has preconnect
const htmlContent = readFileSync('index.html', 'utf-8');
check(
  htmlContent.includes('preconnect'),
  'index.html should have preconnect hints'
);

// 7. Check vite config has build optimization
const viteContent = readFileSync('vite.config.ts', 'utf-8');
check(
  viteContent.includes('manualChunks'),
  'vite.config.ts should have manualChunks for code splitting'
);
check(
  viteContent.includes('cssCodeSplit'),
  'vite.config.ts should enable cssCodeSplit'
);

// 8. Check context.ts doesn't have unused imports
const contextContent = readFileSync(path.join(SRC_DIR, 'context.ts'), 'utf-8');
check(
  contextContent.startsWith('import { createContext, useContext }'),
  'context.ts should have clean imports'
);

// 9. Check main.tsx has optimized bootstrap
const mainContent = readFileSync(path.join(SRC_DIR, 'main.tsx'), 'utf-8');
check(
  mainContent.includes('scheduler.yield') || mainContent.includes('DOMContentLoaded'),
  'main.tsx should use optimized bootstrap (scheduler.yield or DOMContentLoaded)'
);

// 10. Verify the skill directory exists
check(
  existsSync('.pi/skills/frontend-perf-opt/SKILL.md'),
  'frontend-perf-opt skill should exist'
);

console.log(`\n=== Performance Audit Results ===`);
console.log(`Passed: ${passed}/${passed + failed}`);
console.log(`Failed: ${failed}/${passed + failed}`);
if (issues.length > 0) {
  console.log('\nIssues found:');
  issues.forEach((issue, i) => console.log(`  ${i + 1}. ❌ ${issue}`));
} else {
  console.log('\n✅ All checks passed!');
}
