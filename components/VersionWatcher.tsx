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
 *
 * ── 开发模式也要管（2026-09-13 补）──────────────────────────────
 *
 * 金恩来：「之前那个更新了就提醒刷新的功能挺好的，怎么不见了」。
 *
 * 它没不见 —— **它在 localhost 上从来就没生效过**。
 * 上面那套比的是打包文件名 `assets/index-xxxx.js`，
 * 而开发模式下根本没有这个文件，于是 `check()` 第一行直接 return。
 *
 * 可他的走查**几乎全在 localhost 上做**，我又在旁边一直改代码 ——
 * 最需要这个提示的场合，恰恰是它唯一不工作的场合。
 * 今天就因此绕了一圈：他截图说"服务项目又跑到下面去了"，
 * 我在四个宽度实测都是并排的 —— 他那个标签页拿的是旧版本。
 *
 * 开发模式下的失效方式和生产不同：Vite 靠一条 websocket 推更新，
 * **笔记本合盖、断网、切网络之后这条连接会断，而 Vite 什么都不说**。
 * 页面从此停在旧版本，看起来一切正常。
 * 所以这里盯的不是文件名，是**那条连接断没断**。
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
  /** 'build' = 生产比打包文件名；'hmr' = 开发看热更新连接断没断 */
  const [reason, setReason] = useState<'build' | 'hmr'>('build');
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

  /*
    开发模式：盯 Vite 的热更新连接。

    断开 = 从这一刻起页面收不到任何改动了，但它自己不会有任何表现。
    重连 = 断开期间多半错过了更新，Vite 有时能补、有时补不上 ——
    与其猜，不如提示刷新一下，代价只是一次刷新。
  */
  useEffect(() => {
    const hot = (import.meta as any).hot;
    if (!hot) return;
    /*
      只在**断着的时候**提示，重连后自己消失。

      不在重连时再弹一次，是因为 Vite 客户端自己会处理那一步：
      非干净断开之后它会一直 ping，服务器回来就 `location.reload()`。
      再弹一个「请刷新」纯属多余，而且会和它的自动刷新打架。

      这里补的只是那段**断着的空窗期** —— Vite 只在 console 里
      打一行 `server connection lost`，而没有人盯着 console。
      那段时间里页面看起来一切正常，其实已经收不到任何改动了。
    */
    const onDisconnect = () => { setReason('hmr'); setStale(true); };
    const onConnect = () => { setStale(false); };
    hot.on('vite:ws:disconnect', onDisconnect);
    hot.on('vite:ws:connect', onConnect);
    return () => {
      hot.off?.('vite:ws:disconnect', onDisconnect);
      hot.off?.('vite:ws:connect', onConnect);
    };
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
        {/* 两种情况的原因不同，说法也要不同 —— 说错了人会往错的方向查 */}
        <p className="font-black text-gray-900">
          {reason === 'hmr' ? '这个页面可能不是最新的' : '系统已更新'}
        </p>
        <p className="text-xs font-bold text-gray-500">
          {reason === 'hmr'
            ? '和开发服务器断开了，现在收不到改动。连上之后会自动刷新。'
            : '你这个页面还是旧版本，刷新一下才能看到改动。'}
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
