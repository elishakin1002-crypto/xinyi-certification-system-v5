import React from 'react';
import { AlertTriangle, RefreshCw, LayoutDashboard } from 'lucide-react';
import { reportClientError } from '../services/errorReporter';

/**
 * 渲染崩溃兜底。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么必须有（2026-09-09 补）
 * ══════════════════════════════════════════════════════════════
 *
 * 在这之前，**整个系统一个 ErrorBoundary 都没有**。
 * React 的规则是：渲染期间抛出的异常如果没有边界接住，
 * 它会把**整棵树卸载掉** —— 不是那一块坏掉，是整页变白。
 *
 * 对同事来说这长得就像「被踢出去了」：
 * 页面空了，他按刷新，回到登录页或工作台，刚才填的东西全没了。
 * 金恩来 2026-09-09 报的「添加不符合项时被强制退出，两次都是在准备
 * 填写问题描述时」，现象上就是这一类 —— 不管根因是哪一行代码，
 * **没有边界这件事本身就让任何一个小错误升级成全系统白屏**。
 *
 * ── 这个组件解决三件事 ────────────────────────────────────────
 *
 * ① 崩的那一块被围住，其它地方还能用；顶层这一层至少保证有话说，
 *    而不是一片空白让人怀疑是不是自己点错了。
 * ② **把错误报上去**。原来的上报只挂 window.onerror，
 *    而 React 接住的渲染错误不一定会冒到 window 上 ——
 *    结果就是「用户说崩了，服务端一条记录都没有」，正是这次的处境。
 * ③ 给一条出路：刷新，或回工作台。**不清 session、不跳登录页** ——
 *    崩溃跟登录状态没关系，把人踢去重新登录只会让他更慌。
 *
 * ── 有意不做的事 ──────────────────────────────────────────────
 *
 * 不自动刷新。自动刷新会把人正在填的表单冲掉，
 * 而且如果崩溃是稳定复现的，自动刷新就变成无限重启。
 * 让人自己按，他至少知道发生了什么。
 */

interface Props {
  children: React.ReactNode;
  /** 出现在提示里，帮人（和我）定位是哪一块崩的 */
  area?: string;
  /** 崩了之后除了刷新，还能退回哪里 */
  fallbackHref?: string;
}

interface State {
  error: Error | null;
}

export class CrashBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    /*
      componentStack 比 error.stack 有用得多：
      压缩后的 error.stack 是一串看不懂的字母，
      而 componentStack 会直接写出是哪个组件塌的。
    */
    reportClientError('render', error?.message || '渲染异常', {
      source: this.props.area || '',
      stack: `${error?.stack || ''}\n--- 组件栈 ---${info?.componentStack || ''}`,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;

    const href = this.props.fallbackHref || '#/dashboard';
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-lg w-full rounded-3xl border border-red-100 bg-white p-8 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="rounded-2xl bg-red-50 p-3">
              <AlertTriangle className="w-6 h-6 text-red-600" />
            </span>
            <div>
              <h2 className="text-lg font-black text-gray-900">这一块出错了</h2>
              <p className="text-xs font-bold text-gray-500 mt-0.5">
                {this.props.area ? `位置：${this.props.area}` : '不是你操作错了，是系统这里有 bug'}
              </p>
            </div>
          </div>

          {/*
            说清两件他最关心的事：数据丢没丢、还用不用得了。
            光说「出错了」等于什么都没说。
          */}
          <div className="mt-5 space-y-2 text-sm font-bold text-gray-600">
            <p>· 已经保存过的数据不受影响，<span className="text-gray-900">没有丢</span>。</p>
            <p>· 但这个页面上还没保存的内容没了，需要重新填一次。</p>
            <p>· 你还是登录状态，<span className="text-gray-900">不用重新登录</span>。</p>
          </div>

          <p className="mt-4 rounded-2xl bg-gray-50 px-4 py-3 text-[11px] font-mono text-gray-500 break-all">
            {String(this.state.error?.message || '').slice(0, 300) || '未知错误'}
          </p>

          <p className="mt-3 text-xs font-bold text-gray-400">
            这条错误已经自动报给技术，不用你再描述一遍。
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-700"
            >
              <RefreshCw className="w-4 h-4" /> 刷新重试
            </button>
            <a
              href={href}
              onClick={() => this.setState({ error: null })}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-black text-gray-600 hover:bg-gray-50"
            >
              <LayoutDashboard className="w-4 h-4" /> 回工作台
            </a>
          </div>
        </div>
      </div>
    );
  }
}

export default CrashBoundary;
