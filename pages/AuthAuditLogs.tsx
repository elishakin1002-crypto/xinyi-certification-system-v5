import { SampleList } from '../components/SampleRow';
import { SAMPLE_AUDIT_LOG } from '../src/modules/onboarding/sampleRecords';
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileClock, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { EmptyState } from '../src/ui';
import { SampleRow, SampleTr } from '../components/SampleRow';
import LoginSessions from '../components/LoginSessions';
import { authService, AuthAuditLog } from '../services/authService';

const actionLabels: Record<string, string> = {
  USER_CREATE: '创建员工',
  USER_UPDATE: '更新员工',
  USER_DISABLE: '停用员工',
  USER_ENABLE: '启用员工',
  PASSWORD_RESET: '重置密码',
  PASSWORD_CHANGE: '修改密码'
};

const actionTone = (action: string) => {
  if (action === 'USER_DISABLE') return 'bg-red-50 text-red-700 border-red-100';
  if (action === 'PASSWORD_RESET' || action === 'PASSWORD_CHANGE') return 'bg-amber-50 text-amber-700 border-amber-100';
  if (action === 'USER_CREATE' || action === 'USER_ENABLE') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  return 'bg-gray-50 text-gray-700 border-gray-100';
};

const formatTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '-';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const metadataSummary = (metadata: Record<string, unknown>) => {
  const entries = Object.entries(metadata || {});
  if (entries.length === 0) return '-';
  return entries.map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`).join(' | ');
};

const AuthAuditLogs: React.FC = () => {
  const { currentUser, checkActionPermission } = useApp();
  const [logs, setLogs] = useState<AuthAuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  /*
    和 Employees.tsx 同一个漏网点（2026-09-04 一起修）。

    只认 ADMIN 的话，系统管理员看不了审计日志 ——
    而「谁改了权限、谁重置了谁的密码」正是他该盯的东西。
    服务端的 AUTH_AUDIT_VIEW 在 SYS_ADMIN 的能力清单里，一直是放行的。
  */
  /*
    按**动作**判断，不再列角色名单。

    这里先后写错过两次：一次是 roles.includes('ADMIN')，把系统管理员
    挡在门外；改成 ADMIN||SYS_ADMIN 之后，给总助加权限时又得回来改一遍。
    权限矩阵里已经有 AUTH_AUDIT_VIEW 了，这里再维护一份角色名单，
    两份迟早对不上 —— 而对不上的表现就是「服务端放行、界面说没权限」。
  */
  const isAdmin = checkActionPermission('AUTH_AUDIT_VIEW').allowed;
  const latestLogs = useMemo(() => logs.slice(0, 100), [logs]);

  const loadLogs = async () => {
    setIsLoading(true);
    setError('');
    try {
      setLogs(await authService.listAuditLogs(100));
    } catch (err) {
      setError(err instanceof Error ? err.message : '审计日志加载失败');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) loadLogs();
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="border border-amber-200 bg-amber-50 rounded-lg px-4 py-3 text-sm font-bold text-amber-800">
          当前账号没有审计日志查看权限
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1600px] mx-auto">
      {/*
        「谁在哪登录着」放在审计日志页最上面，而不是埋进设置里。

        它回答的是当下的问题（现在谁登着、要不要踢），
        下面的日志回答的是过去的问题（谁改了什么）。
        当下的事更急，所以排在前面。
      */}
      <LoginSessions all />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900">审计日志</h1>
          <p className="text-sm text-gray-500 mt-1">查看员工账号创建、修改、停用、启用与密码动作</p>
        </div>
        <button
          onClick={loadLogs}
          className="inline-flex items-center px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-bold text-gray-700 hover:bg-gray-50 w-fit"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          刷新
        </button>
      </div>

      {error && (
        <div className="rounded-lg px-4 py-3 text-sm font-bold bg-red-50 text-red-700 border border-red-100">
          {error}
        </div>
      )}

      <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center text-sm font-black text-gray-900">
            <FileClock className="w-4 h-4 mr-2 text-blue-600" />
            最近 100 条
          </div>
          <span className="inline-flex items-center text-xs font-bold text-gray-500">
            <ShieldCheck className="w-3.5 h-3.5 mr-1" />
            管理员可见
          </span>
        </div>

        {isLoading ? (
          <div className="h-48 flex items-center justify-center text-sm font-bold text-gray-500">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            加载中
          </div>
        ) : (
          <>
          {latestLogs.length === 0 && <EmptyState title="还没有审计记录" hint="样例只用于说明列与字段，不是实际操作记录。" />}
          {/*
            手机上给卡片，不给横向拖的表格（2026-09-08 补）。
            审计日志的列很多（时间/动作/操作人/对象/IP/结果），
            在手机上横拖是看不完的 —— 而查日志这件事往往就发生在
            「出事了、人不在电脑前」的时候。
          */}
          <div className="block md:hidden divide-y divide-gray-100">
            <SampleList items={latestLogs} sample={SAMPLE_AUDIT_LOG} render={log => (
              <div key={log.id} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  {/* 手机端原来直接吐 USER_CREATE 这种内部代码 —— 桌面早就有中文映射，
                      只是这一处没用它。日常列表不该要求人去理解操作码。 */}
                  <span className="text-sm font-black text-gray-900">
                    {actionLabels[String((log as any).action || '')] || String((log as any).action || '—')}
                  </span>
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-black ${
                    String((log as any).result || '').includes('拒') || (log as any).ok === false
                      ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
                  }`}>
                    {(log as any).ok === false ? '被拒绝' : '成功'}
                  </span>
                </div>
                <div className="mt-1 text-[11px] font-bold text-gray-500">
                  {String((log as any).createdAt || (log as any).at || '')}
                  <span className="mx-1 text-gray-300">·</span>
                  {String((log as any).actorName || (log as any).actor || '—')}
                </div>
              </div>
            )} />
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-black">时间</th>
                  <th className="px-4 py-3 text-left font-black">动作</th>
                  <th className="px-4 py-3 text-left font-black">操作人</th>
                  <th className="px-4 py-3 text-left font-black">对象</th>
                  <th className="px-4 py-3 text-left font-black">详情</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">

                <SampleList items={latestLogs} sample={SAMPLE_AUDIT_LOG} render={log => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap text-gray-700 font-bold">{formatTime(log.createdAt)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-1 rounded-md text-xs font-black border ${actionTone(log.action)}`}>
                        {actionLabels[log.action] || log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-gray-900 whitespace-nowrap">{log.actorName || '-'}</div>
                      <div className="text-xs text-gray-400 mt-0.5 whitespace-nowrap">{log.actorUserId || '-'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-gray-900 whitespace-nowrap">{log.targetName || '-'}</div>
                      <div className="text-xs text-gray-400 mt-0.5 whitespace-nowrap">{log.targetUserId || '-'}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 min-w-[320px] max-w-[560px]">
                      <div className="line-clamp-2">{metadataSummary(log.metadata)}</div>
                    </td>
                  </tr>
                )} />
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>
    </div>
  );
};

export default AuthAuditLogs;
