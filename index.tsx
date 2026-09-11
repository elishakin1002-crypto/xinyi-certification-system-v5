import React from 'react';
import ReactDOM, { type Root } from 'react-dom/client';
import App from './App';
import CrashBoundary from './components/CrashBoundary';
import { installErrorReporter } from './services/errorReporter';

/*
  错误上报要在**渲染之前**装好。
  装在 App 内部的话，App 自己挂掉时监听器还没注册 ——
  而「首屏就崩了」恰恰是最该被记录、也最容易漏掉的那一类。
*/
installErrorReporter();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

declare global {
  interface Window {
    __xinyiReactRoot?: Root;
  }
}

const root = window.__xinyiReactRoot ?? ReactDOM.createRoot(rootElement);
window.__xinyiReactRoot = root;
/*
  最外面这一层兜的是 Layout、AppContext、路由这些**页面级边界够不到**的地方。
  它们一塌，页面级边界跟着一起没了，所以必须在更外面再有一层。
  正常情况下这一层永远不显示 —— 它的价值全在「整页白掉」这件事不再发生。
*/
root.render(
  <React.StrictMode>
    <CrashBoundary area="应用整体">
      <App />
    </CrashBoundary>
  </React.StrictMode>
);
