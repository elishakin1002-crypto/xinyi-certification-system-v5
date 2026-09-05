import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

/**
 * 发新版之后提醒刷新。
 *
 * ── 为什么需要 ────────────────────────────────────────────────
 *
 * 2026-09-05 同一件事发生了三次：我改完部署上线，金恩来那边看到的还是旧的，
 * 于是「这个功能没做」和「浏览器没拿到新包」看起来一模一样，
 * 两边都在猜。
 *
 * 服务端其实是对的（index.html 是 no-store，也没有 Service Worker），
 * 但只要标签页一直开着不刷新，页面就一直是旧的 ——
 * 而**没有人会在用系统的时候想到「我该刷新一下」**。
 *
 * 这条对 13 个同事更要紧：他们不会怀疑是版本问题，
 * 只会觉得「说好修了的怎么还这样」，然后不再反馈。
 *
 * ── 做法 ──────────────────────────────────────────────────────
 * 每隔几分钟、以及每次切回这个标签页时，取一次 index.html，
 * 比对里面的打包文件名。变了就说明发过新版。
 *
 * **只提示，不自动刷新。** 自动刷新可能把人正在填的表单冲掉 ——
 * 为了一个版本提示毁掉半小时的录入，代价完全不成比例。
 */

/** 轮询间隔。不用太密：发版是低频事，而每次请求都是一次真实流量 */
const POLL_MS = 5 * 60 * 1000;

const readBundle = (html: string) => {
  const m = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
  return m ? m[0] : '';
};

const currentBundle = () => {
  if (typeof document === 'undefined') return '';
  const el = Array.from(document.querySelectorAll('script[src]'))
    .map((s) => s.getAttribute('src') || '')
    .find((s) => /assets\/index-[A-Za-z0-9_-]+\.js/.test(s));
  return el ? (el.match(/assets\/index-[A-Za-z0-9_-]+\.js/) || [''])[0] : '';
};

export const VersionWatcher: React.FC = () => {
  const [stale, setStale] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const mine = useRef(currentBundle());

  const check = useCallback(async () => {
    if (!mine.current) return;   // 开发模式下没有打包文件名，不用比
    try {
      const res = await fetch(`/index.html?v=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const latest = readBundle(await res.text());
      if (latest && latest !== mine.current) setStale(true);
    } catch {
      /* 网络不通就跳过。**这里绝不能提示什么** ——
         断网时弹「有新版本」只会让人更慌，而它其实什么也没发生 */
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(check, POLL_MS);
    // 切回标签页时立刻查一次：人回来看系统的那一刻，正是最该拿到新版的时候
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check]);

  if (!stale || dismissed) return null;

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 rounded-xl border border-blue-200 bg-white px-4 py-3 shadow-lg">
      <div className="text-sm">
        <p className="font-black text-gray-900">系统已更新</p>
        <p className="text-xs font-bold text-gray-500">
          你这个页面还是旧版本，刷新一下才能看到改动。
        </p>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-700"
      >
        <RefreshCw className="w-3.5 h-3.5" /> 刷新
      </button>
      {/*
        允许关掉：万一他正在填一张长表单，这时候刷新就白填了。
        关掉之后不再骚扰，下次自己刷新时自然就更新了。
      */}
      <button
        onClick={() => setDismissed(true)}
        aria-label="稍后再说"
        className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export default VersionWatcher;
