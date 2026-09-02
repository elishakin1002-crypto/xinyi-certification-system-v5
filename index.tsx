import React from 'react';
import ReactDOM, { type Root } from 'react-dom/client';
import App from './App';
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
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
