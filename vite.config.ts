import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      // 启用 CSS 代码分割
      cssCodeSplit: true,
      // 减少源码映射体积（生产环境不需要详细映射）
      sourcemap: false,
      // 启用 rollup 缓存加速二次构建
      rollupOptions: {
        output: {
          // 更细粒度的代码分割
          manualChunks: {
            'lucide': ['lucide-react'],
            'router': ['react-router-dom'],
            'motion': ['motion'],
          },
        },
      },
      // 目标浏览器
      target: 'es2020' as const,
      // 压缩选项
      minify: 'esbuild' as const,
      cssMinify: 'esbuild' as const,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      allowedHosts: ['dh.uuuc4.uno'],
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: ['**/data/acg-cache/**'],
      },
    },
  };
});
