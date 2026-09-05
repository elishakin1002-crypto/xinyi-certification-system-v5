import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, LogOut, Monitor, RefreshCw, Smartphone } from 'lucide-react';
import { authService, LoginSession } from '../services/authService';

/**
 * 登录设备列表 + 一键下线。
 *
 * ── 为什么这个比「把会话时长调短」更重要 ──────────────────────
 *
 * 长会话（勾了「常用电脑」的 14 天）的风险不是时间长，
 * 是**你不知道自己在哪些地方还登着**。
 *
 * 猜一个超时数字，短了天天添堵，长了心里没底；
 * 而看得见、踢得掉，就把「心里没底」这件事直接解决了 ——
 * 换了电脑、手机丢了、在客户那儿借电脑登过一次，
 * 回来点一下就清干净。
 *
 * ── 为什么不显示会话令牌 ──────────────────────────────────────
 * 令牌等同于密码。列表只给「什么设备、什么时候、什么 IP」，
 * 足够判断「这台是不是我」，而看到令牌本身对判断没有任何帮助。
 */

const deviceLabel = (ua: string) => {
  const s = String(ua || '');
  const mobile = /iPhone|Android|iPad|Mobile/i.test(s);
  const os = /iPhone|iPad/i.test(s) ? 'iPhone / iPad'
    : /Android/i.test(s) ? 'Android 手机'
    : /Mac OS X|Macintosh/i.test(s) ? 'Mac'
    : /Windows/i.test(s) ? 'Windows 电脑'
    : /Linux/i.test(s) ? 'Linux' : '未知设备';
  const br = /Edg\//i.test(s) ? 'Edge'
    : /Chrome\//i.test(s) ? 'Chrome'
    : /Safari\//i.test(s) ? 'Safari'
    : /Firefox\//i.test(s) ? 'Firefox' : '';
  return { mobile, text: br ? `${os} · ${br}` : os };
};

const when = (iso: string) => {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '—';
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 2) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(t).toLocaleDateString('zh-CN');
};

export const LoginSessions: React.FC<{
  /** true = 看全公司（仅总经理/系统管理员）；false = 只看自己 */
  all?: boolean;
}> = ({ all = false }) => {
  const [list, setList] = useState<LoginSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await authService.listSessions(all);
      setList(r.sessions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取登录设备失败');
    } finally {
      setLoading(false);
    }
  }, [all]);

  useEffect(() => { load(); }, [load]);

  const kick = async (s: LoginSession) => {
    setBusyId(s.id);
    setError('');
    try {
      await authService.revokeSession(s.id);
      setList(prev => prev.filter(x => x.id !== s.id));
      /*
        踢的是自己正在用的这一台 —— 服务端已经清了 cookie，
        再留在页面上只会在下一次点击时莫名其妙报错，不如直接回登录页。
      */
      if (s.isCurrent) window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '下线失败');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-base font-black text-gray-900">
          {all ? '谁在哪登录着' : '我的登录设备'}
        </h2>
        <button
          onClick={load}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className="w-3.5 h-3.5" /> 刷新
        </button>
      </div>
      <p className="text-xs font-bold text-gray-400 mb-4">
        {all
          ? '每一行是一次还没过期的登录。看到不认识的，直接下线。'
          : '看到不是自己的设备，点「下线」——它会立刻失效，不用改密码。'}
      </p>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 py-6 justify-center text-sm font-bold text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" /> 读取中
        </p>
      ) : list.length === 0 ? (
        <p className="py-6 text-center text-sm font-bold text-gray-400">没有正在生效的登录。</p>
      ) : (
        <ul className="flex flex-col divide-y divide-gray-100">
          {list.map(s => {
            const dev = deviceLabel(s.userAgent);
            return (
              <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-start gap-3 min-w-0">
                  <span className="mt-0.5 text-gray-400 shrink-0">
                    {dev.mobile ? <Smartphone className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-gray-800">
                        {all ? `${s.userName}　${dev.text}` : dev.text}
                      </span>
                      {s.isCurrent && (
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-black bg-emerald-50 text-emerald-700">
                          当前这台
                        </span>
                      )}
                      {s.remembered && (
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-black bg-blue-50 text-blue-700">
                          常用设备
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-bold text-gray-400 truncate">
                      最近活跃 {when(s.lastSeenAt || s.createdAt)}
                      {s.ip ? ` · ${s.ip}` : ''}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => kick(s)}
                  disabled={busyId === s.id}
                  className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-bold text-gray-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-60"
                >
                  {busyId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
                  {s.isCurrent ? '退出这台' : '下线'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default LoginSessions;
