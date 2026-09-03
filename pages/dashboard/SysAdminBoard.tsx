/**
 * 系统管理员工作台。
 *
 * ── 为什么不复用业务工作台 ────────────────────────────────────
 * 系统管理员关心的和业务角色**完全不重叠**：
 * 他不看这个月签了几单，看的是服务健不健康、AI 花了多少钱、
 * 有没有异常登录、同事有没有踩到 bug 却没说。
 *
 * 硬塞进业务工作台的话，他每天要在一堆和自己无关的 KPI 里
 * 找那两三个真正相关的数字 —— 找几天之后就不看了。
 *
 * ── 编排原则：按「要不要立刻处理」排，不按模块排 ──────────────
 * 最上面是**今天有没有事**（错误、异常登录），
 * 中间是**趋势和成本**（AI 花费），
 * 最下面是**静态信息**（版本、数据规模）——那些平时不用看。
 */
import React, { useEffect, useState } from 'react';
import {
  Activity, AlertTriangle, Bot, Database, HardDrive, KeyRound,
  RefreshCw, ShieldCheck, Sliders, Users, Wrench
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

type Overview = {
  errors: { today: { kinds: number; occurrences: number; unhandled: number };
            top: Array<{ kind: string; message: string; route: string; count: number; affected: number; status: string }> } | null;
  ai: { month: { calls: number; failures: number; tokens: string | number };
        today: { calls: number; tokens: string | number };
        byUser: Array<{ name: string; calls: number; tokens: string | number }> } | null;
  security: { sessions: Array<{ name: string; username: string; ip: string; created_at: string; last_seen_at: string | null }>;
              accounts: { total: number; pending_password: number; disabled: number; expired: number };
              deniedRecent: { n: number } } | null;
  data: { size: string; rows: Array<{ table: string; rows: number }> } | null;
  version: { app: string; node: string; uptimeHours: number; migrations: { applied: number; latest: string } | null };
  generatedAt: string;
};

const KIND_LABEL: Record<string, string> = {
  js: '页面报错', promise: '操作静默失败', api: '接口错误', render: '渲染失败',
};

const num = (v: unknown) => Number(v || 0).toLocaleString('zh-CN');

const Card: React.FC<{ title: string; icon: React.ReactNode; tone?: 'normal' | 'alert'; children: React.ReactNode; action?: React.ReactNode }> =
  ({ title, icon, tone = 'normal', children, action }) => (
  <div className={`bg-white rounded-2xl border p-5 ${tone === 'alert' ? 'border-red-200' : 'border-gray-100'}`}>
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <span className={tone === 'alert' ? 'text-red-500' : 'text-gray-400'}>{icon}</span>
        <h3 className="text-sm font-black text-gray-900">{title}</h3>
      </div>
      {action}
    </div>
    {children}
  </div>
);

const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: 'normal' | 'alert' | 'muted' }> =
  ({ label, value, tone = 'normal' }) => (
  <div>
    <p className={`text-2xl font-black ${tone === 'alert' ? 'text-red-600' : tone === 'muted' ? 'text-gray-400' : 'text-gray-900'}`}>{value}</p>
    <p className="text-[11px] text-gray-400 mt-0.5">{label}</p>
  </div>
);

const SysAdminBoard: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/sysadmin-overview', { credentials: 'include' });
      const body = await res.json();
      if (!res.ok || body.ok === false) throw new Error(body.message || `HTTP ${res.status}`);
      setData(body.data);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading && !data) {
    return <div className="p-8 text-sm text-gray-400">正在读取系统状态…</div>;
  }
  if (error && !data) {
    return (
      <div className="p-8">
        <p className="text-sm font-bold text-red-600">读取系统状态失败：{error}</p>
        <button onClick={load} className="mt-3 text-xs font-bold text-blue-600">重试</button>
      </div>
    );
  }

  const errs = data?.errors;
  const ai = data?.ai;
  const sec = data?.security;
  const hasErrors = (errs?.today.unhandled || 0) > 0;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900">系统管理员</h1>
          <p className="text-sm text-gray-500 mt-1">
            运维视角：先看今天有没有事，再看成本和趋势。
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg px-3 py-2"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
      </div>

      {/*
        第一排 = 今天要不要管。
        有未处理错误就整块变红 —— 不靠人去逐个数字比对，
        看板的第一职责是「一眼看出有没有事」。
      */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card title="今日错误" icon={<AlertTriangle className="w-4 h-4" />} tone={hasErrors ? 'alert' : 'normal'}>
          <div className="flex items-end gap-6">
            <Stat label="种类" value={errs?.today.kinds ?? '—'} tone={hasErrors ? 'alert' : 'muted'} />
            <Stat label="发生次数" value={num(errs?.today.occurrences)} tone="muted" />
          </div>
          <p className="text-[11px] text-gray-400 mt-3">
            {hasErrors ? `${errs?.today.unhandled} 个待处理` : '没有新错误'}
          </p>
        </Card>

        <Card title="当前在线" icon={<Users className="w-4 h-4" />}>
          <Stat label="活跃会话" value={sec?.sessions.length ?? '—'} />
          <p className="text-[11px] text-gray-400 mt-3">
            {/* 同一个账号多个会话是正常的（电脑+手机），异常的是陌生 IP */}
            同一个人可能有多个设备
          </p>
        </Card>

        <Card title="待改密码" icon={<KeyRound className="w-4 h-4" />}>
          <Stat
            label="还没首次登录的账号"
            value={sec?.accounts.pending_password ?? '—'}
            tone={(sec?.accounts.pending_password || 0) > 0 ? 'normal' : 'muted'}
          />
          <p className="text-[11px] text-gray-400 mt-3">共 {sec?.accounts.total ?? '—'} 个账号</p>
        </Card>

        <Card title="服务" icon={<Activity className="w-4 h-4" />}>
          <Stat label="连续运行（小时）" value={data?.version.uptimeHours ?? '—'} />
          <p className="text-[11px] text-gray-400 mt-3">
            {/* 这个数字反复变小 = 在崩溃循环，不写出来发现不了 */}
            数字反复归零说明服务在反复重启
          </p>
        </Card>
      </div>

      {/* 错误明细 */}
      <Card
        title="同事踩到但没说的问题"
        icon={<Wrench className="w-4 h-4" />}
        tone={hasErrors ? 'alert' : 'normal'}
      >
        {!errs?.top?.length ? (
          <p className="text-sm text-gray-400 py-6 text-center">最近 7 天没有未处理的错误</p>
        ) : (
          <div className="space-y-2">
            {errs.top.map((e, i) => (
              <div key={i} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
                <span className="text-[10px] font-black text-gray-400 bg-gray-100 rounded px-1.5 py-0.5 shrink-0 mt-0.5">
                  {KIND_LABEL[e.kind] || e.kind}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-800 break-words">{e.message}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {e.route || '—'} · {/* 影响人数放前面：3 个人各碰 1 次，比 1 个人碰 100 次严重 */}
                    影响 {e.affected} 人，发生 {e.count} 次
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* AI 成本 */}
        <Card
          title="AI 用量与成本"
          icon={<Bot className="w-4 h-4" />}
          action={
            <button
              onClick={() => navigate('/ai-center')}
              className="text-[11px] font-bold text-blue-600 hover:text-blue-700"
            >
              AI 配置中心 →
            </button>
          }
        >
          <div className="flex items-end gap-8 mb-4">
            <Stat label="本月调用" value={num(ai?.month.calls)} />
            <Stat label="本月 token" value={num(ai?.month.tokens)} />
            <Stat
              label="失败"
              value={num(ai?.month.failures)}
              tone={(Number(ai?.month.failures) || 0) > 0 ? 'alert' : 'muted'}
            />
          </div>
          {ai?.byUser?.length ? (
            <div className="space-y-1.5">
              <p className="text-[10px] font-black text-gray-400 tracking-widest">本月按人</p>
              {ai.byUser.map((u, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-gray-700">{u.name}</span>
                  <span className="text-gray-400">{num(u.tokens)} token · {u.calls} 次</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400">本月还没有 AI 调用</p>
          )}
        </Card>

        {/* 安全 */}
        <Card title="安全" icon={<ShieldCheck className="w-4 h-4" />}>
          <div className="flex items-end gap-8 mb-4">
            <Stat
              label="7 天内被拦的越权请求"
              value={num(sec?.deniedRecent?.n)}
              tone={(Number(sec?.deniedRecent?.n) || 0) > 0 ? 'alert' : 'muted'}
            />
            <Stat label="停用账号" value={num(sec?.accounts.disabled)} tone="muted" />
            <Stat
              label="已过期"
              value={num(sec?.accounts.expired)}
              tone={(Number(sec?.accounts.expired) || 0) > 0 ? 'alert' : 'muted'}
            />
          </div>
          <p className="text-[10px] font-black text-gray-400 tracking-widest mb-1.5">当前登录</p>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {!sec?.sessions?.length ? (
              <p className="text-xs text-gray-400">没有活跃会话</p>
            ) : sec.sessions.map((s, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-gray-700">{s.name}</span>
                <span className="text-gray-400 font-mono text-[10px]">{s.ip}</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => navigate('/auth-audit')}
            className="mt-3 text-[11px] font-bold text-blue-600 hover:text-blue-700"
          >
            审计日志 →
          </button>
        </Card>
      </div>

      {/* 最下面：平时不用看的静态信息 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="数据规模" icon={<Database className="w-4 h-4" />}>
          <p className="text-sm font-black text-gray-900 mb-3">{data?.data?.size || '—'}</p>
          <div className="space-y-1">
            {(data?.data?.rows || []).map((r, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-gray-600 font-mono text-[11px]">{r.table}</span>
                <span className="text-gray-400">{num(r.rows)} 行</span>
              </div>
            ))}
          </div>
        </Card>

        <Card
          title="版本与升级"
          icon={<HardDrive className="w-4 h-4" />}
          action={
            <button
              onClick={() => navigate('/employees')}
              className="text-[11px] font-bold text-blue-600 hover:text-blue-700"
            >
              员工账号 →
            </button>
          }
        >
          <div className="space-y-2 text-xs">
            <div className="flex justify-between"><span className="text-gray-500">应用版本</span><span className="font-bold text-gray-900">{data?.version.app}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Node</span><span className="font-mono text-gray-700">{data?.version.node}</span></div>
            <div className="flex justify-between">
              <span className="text-gray-500">数据库迁移</span>
              <span className="text-gray-700">
                已执行 {data?.version.migrations?.applied ?? '—'} 个 · 最新 {data?.version.migrations?.latest ?? '—'}
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-gray-50 flex gap-3">
            <button onClick={() => navigate('/ai-center')} className="flex items-center gap-1 text-[11px] font-bold text-gray-500 hover:text-gray-700">
              <Sliders className="w-3 h-3" /> AI 配置
            </button>
          </div>
        </Card>
      </div>

      <p className="text-[10px] text-gray-300 text-center">
        数据生成于 {data?.generatedAt ? new Date(data.generatedAt).toLocaleString('zh-CN') : '—'}
      </p>
    </div>
  );
};

export default SysAdminBoard;
