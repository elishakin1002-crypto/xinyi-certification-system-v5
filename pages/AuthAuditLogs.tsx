import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileClock, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
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
  return 'bg-slate-50 text-slate-700 border-slate-100';
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
  const { currentUser } = useApp();
  const [logs, setLogs] = useState<AuthAuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const isAdmin = currentUser.roles.includes('ADMIN');
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
        ) : latestLogs.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-sm font-bold text-gray-500">
            <AlertTriangle className="w-4 h-4 mr-2" />
            暂无审计日志
          </div>
        ) : (
          <div className="overflow-x-auto">
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
                {latestLogs.map(log => (
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default AuthAuditLogs;
