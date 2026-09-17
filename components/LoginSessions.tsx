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

/**
 * 把「一次登录」合并成「一台设备」。
 *
 * ── 为什么要合并（2026-09-12）────────────────────────────────
 *
 * 金恩来：「为什么出现那么多台 Mac Chrome？」
 *
 * 因为登录成功就往 auth_sessions 插一条，**没有任何按设备去重**。
 * 同一台电脑登十次 = 十行，而且十行长得一模一样（UA 相同）。
 *
 * 这不只是难看，它**把这一页的用处废掉了**：
 * 这一页存在的唯一理由是「看到不是自己的设备就下线」，
 * 而十行同名的东西里根本挑不出那个陌生的。
 * 越常用系统的人，列表越长、越没法用 —— 正好反了。
 *
 * 所以按「设备」归并：同一个 UA + 同一个 IP 视为同一台。
 * 显示最近一次活跃，下线时把这台上的**每一次登录**都踢掉 ——
 * 只踢一条等于没踢，剩下的会话照样能用。
 */
export interface DeviceGroup {
  key: string;
  sessions: LoginSession[];
  latest: LoginSession;
  /** 这台设备上还活着几次登录 */
  count: number;
  isCurrent: boolean;
  remembered: boolean;
}

export const groupByDevice = (list: LoginSession[]): DeviceGroup[] => {
  const map = new Map<string, LoginSession[]>();
  for (const s of list) {
    // 带上 userId：看全公司那一档里，两个人用同型号电脑不能并成一台
    const key = `${s.userId || ''}|${s.userAgent || ''}|${s.ip || ''}`;
    map.set(key, [...(map.get(key) || []), s]);
  }
  const at = (s: LoginSession) => Date.parse(s.lastSeenAt || s.createdAt || '') || 0;
  return Array.from(map.entries())
    .map(([key, sessions]) => {
      const sorted = [...sessions].sort((a, b) => at(b) - at(a));
      return {
        key,
        sessions: sorted,
        latest: sorted[0],
        count: sorted.length,
        // 只要这台上有一条是当前会话，这台就是「当前这台」
        isCurrent: sorted.some(s => s.isCurrent),
        remembered: sorted.some(s => s.remembered),
      };
    })
    .sort((a, b) => (b.isCurrent ? 1 : 0) - (a.isCurrent ? 1 : 0) || at(b.latest) - at(a.latest));
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

  /*
    踢的是「一台设备」，不是「一次登录」。

    这台上可能压着好几次登录（每次登录插一条）。只撤其中一条，
    别人换个标签页照样在线 —— 那等于点了个没用的按钮，
    而人还以为自己已经把对方踢下去了。**安全动作最怕这种假成功。**
  */
  const kick = async (g: DeviceGroup) => {
    setBusyId(g.key);
    setError('');
    try {
      for (const s of g.sessions) await authService.revokeSession(s.id);
      const gone = new Set(g.sessions.map(s => s.id));
      setList(prev => prev.filter(x => !gone.has(x.id)));
      /*
        踢的是自己正在用的这一台 —— 服务端已经清了 cookie，
        再留在页面上只会在下一次点击时莫名其妙报错，不如直接回登录页。
      */
      if (g.isCurrent) window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '下线失败');
    } finally {
      setBusyId('');
    }
  };

  const devices = groupByDevice(list);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-base font-black text-gray-900">
          {all ? '谁在哪登录着' : '我的登录设备'}
        </h2>
        {/*
          没权限时不给「刷新」（2026-09-17 加）。

          总助能进审计日志页，但 /api/auth/sessions 只对总经理和系统管理员开放。
          于是她看到一个「刷新」按钮，点一次 403 一次，**永远不可能成功**。
          一个注定失败的按钮比没有按钮更糟 —— 她会以为是系统坏了，
          或者以为自己点得不对，反复点。
        */}
        {!error && (
          <button
            onClick={load}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50"
          >
            <RefreshCw className="w-3.5 h-3.5" /> 刷新
          </button>
        )}
      </div>
      <p className="text-xs font-bold text-gray-400 mb-4">
        {all
          ? '每一行是一台还登录着的设备。看到不认识的，直接下线。'
          : '每一行是一台设备（同一台上登过几次会并成一行）。看到不是自己的，点「下线」——它立刻失效，不用改密码。'}
      </p>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 py-6 justify-center text-sm font-bold text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" /> 读取中
        </p>
      ) : error ? (
        /*
          ── 读不到 ≠ 没有（2026-09-17 修）────────────────────────────

          原来只要 list 是空的就说「没有正在生效的登录」。
          而总助读这个接口会 403，list 自然是空，于是她那一屏上
          同时出现两句自相矛盾的话：

              只有总经理和系统管理员能看全部登录设备   ← 对
              没有正在生效的登录。                     ← 假的

          「没有」是一句**关于事实的断言**，而这里的真相是"我看不到"。
          安全相关的页面上说假话尤其要不得：她可能据此认为没人登着。

          出错时只说出错，不要顺带断言一个我们并不知道的事实。
        */
        null
      ) : list.length === 0 ? (
        <p className="py-6 text-center text-sm font-bold text-gray-400">没有正在生效的登录。</p>
      ) : (
        <ul className="flex flex-col divide-y divide-gray-100">
          {devices.map(g => {
            const s = g.latest;
            const dev = deviceLabel(s.userAgent);
            return (
              <li key={g.key} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-start gap-3 min-w-0">
                  <span className="mt-0.5 text-gray-400 shrink-0">
                    {dev.mobile ? <Smartphone className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-gray-800">
                        {all ? `${s.userName}　${dev.text}` : dev.text}
                      </span>
                      {g.isCurrent && (
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-black bg-emerald-50 text-emerald-700">
                          当前这台
                        </span>
                      )}
                      {/*
                        原来这里写「常用设备」，是**错的**：它对应的是登录时
                        勾没勾「这台电脑我常用，14 天内免登录」，
                        和用得多不多没有关系。照字面读会以为系统认得这台机器。
                        改成照抄登录页那句话，两边对得上。
                      */}
                      {g.remembered && (
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-black bg-blue-50 text-blue-700">
                          14 天免登录
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-bold text-gray-400 truncate">
                      最近活跃 {when(s.lastSeenAt || s.createdAt)}
                      {s.ip ? ` · ${s.ip}` : ''}
                      {/* 说清这台上压着几次登录，否则「下线」踢掉多少人心里没数 */}
                      {g.count > 1 ? ` · 这台上有 ${g.count} 次登录` : ''}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => kick(g)}
                  disabled={busyId === g.key}
                  className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-bold text-gray-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-60"
                >
                  {busyId === g.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
                  {g.isCurrent ? '退出这台' : '下线'}
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
