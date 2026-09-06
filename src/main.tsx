import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {initializeBackgroundPreference} from './background-settings';
import {initializeColorModePreference, initializeUiThemePreference} from './ui-theme';
import './index.css';

// 移除加载指示器
function removeLoadingShell() {
  const shell = document.getElementById('loading-shell');
  if (shell) {
    shell.classList.add('fade-out');
    shell.addEventListener('transitionend', () => shell.remove(), { once: true });
    setTimeout(() => shell.remove(), 500);
  }
}

initializeBackgroundPreference();
initializeColorModePreference();

// 注入浮动粒子样式（body 伪元素已达上限，只能通过 JS 注入独立 div）
function injectParticleStyles() {
  if (document.getElementById('bg-particle-style')) return;
  
  const style = document.createElement('style');
  style.id = 'bg-particle-style';
  style.textContent = `
    #bg-particles {
      position: fixed; inset: 0; z-index: 1;
      pointer-events: none; overflow: hidden;
    }
    #bg-particles::before, #bg-particles::after {
      content: ''; position: absolute;
      border-radius: 50%; pointer-events: none;
    }
    #bg-particles::before {
      width: 160px; height: 160px;
      top: 12%; left: 8%;
      background: radial-gradient(circle, rgba(236,72,153,0.10), transparent 70%);
    }
    #bg-particles::after {
      width: 120px; height: 120px;
      top: 65%; right: 12%;
      background: radial-gradient(circle, rgba(168,85,247,0.08), transparent 70%);
    }
    /* 性能优化：粒子动画静态化。
       原 particle-float 持续 22s/28s 在玻璃层（header/aside/卡片 backdrop-filter）
       背后移动，导致所有玻璃层每帧重采样（静止 GPU 占用 >20% 的主因）；
       静态光晕视觉与动画差异极小。 */
    @media (prefers-reduced-motion: reduce) {
      #bg-particles { display: none; }
    }
  `;
  document.head.appendChild(style);
  
  const container = document.createElement('div');
  container.id = 'bg-particles';
  container.setAttribute('aria-hidden', 'true');
  document.body.appendChild(container);
}
injectParticleStyles();

async function bootstrap() {
  try {
    await initializeUiThemePreference();
  } catch (error) {
    console.warn("Unable to load saved UI theme, falling back to classic.", error);
  }

  // 使用 createRoot 并发特性，优先渲染 UI 再执行非关键任务
  const root = createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  
  // 首次渲染后移除 loading 指示器 — 使用 scheduler.yield 避免抢占主线程
  if ('scheduler' in window && 'yield' in (window as any).scheduler) {
    (window as any).scheduler.yield().then(removeLoadingShell);
  } else {
    requestAnimationFrame(removeLoadingShell);
  }
}

// 使用更快的启动路径
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void bootstrap(), { once: true });
} else {
  void bootstrap();
}
