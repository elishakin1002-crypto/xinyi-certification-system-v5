import React from 'react';
import ReactDOM, { type Root } from 'react-dom/client';
import App from './App';

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
