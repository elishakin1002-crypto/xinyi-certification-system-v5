import React, { useEffect, useMemo, useState } from 'react';
import { Check, KeyRound, Loader2, Plus, RefreshCw, Save, ShieldCheck, UserPlus } from 'lucide-react';
import { ACTION_META, ACTION_GROUPS, ROLE_CAPABILITIES, SYSTEM_ROLES } from '../constants';
import { useApp } from '../context/AppContext';
import { RoleID, ActionCode } from '../types';
import { authService, EmployeeAccount, EmployeeAccountInput } from '../services/authService';

type FormState = {
  email: string;
  username: string;
  name: string;
  password: string;
  roles: RoleID[];
  activeRole: RoleID;
  positionTagsText: string;
  reportsToUserId: string;
  status: 'active' | 'disabled';
  extraActions: ActionCode[];
  deniedActions: ActionCode[];
  accountExpiresAt: string;
};

const emptyForm: FormState = {
  email: '',
  username: '',
  name: '',
  password: '',
  roles: ['CONSULTANT'],
  activeRole: 'CONSULTANT',
  positionTagsText: '',
  reportsToUserId: '',
  status: 'active',
  extraActions: [],
  deniedActions: [],
  accountExpiresAt: ''
};

const roleName = (roleId: RoleID) => SYSTEM_ROLES.find(role => role.id === roleId)?.name || roleId;

const tagsFromText = (text: string) => text
  .split(/[,，]/)
  .map(item => item.trim())
  .filter(Boolean);

const toPayload = (form: FormState): EmployeeAccountInput => ({
  email: form.email.trim(),
  username: form.username.trim(),
  name: form.name.trim(),
  password: form.password,
  roles: form.roles,
  activeRole: form.roles.includes(form.activeRole) ? form.activeRole : form.roles[0],
  positionTags: tagsFromText(form.positionTagsText),
  reportsToUserId: form.reportsToUserId,
  status: form.status,
  extraActions: form.extraActions,
  deniedActions: form.deniedActions,
  accountExpiresAt: form.accountExpiresAt
});

const Employees: React.FC = () => {
  const { currentUser } = useApp();
  const [users, setUsers] = useState<EmployeeAccount[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingUserId, setEditingUserId] = useState('');
  const [resetUserId, setResetUserId] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const isAdmin = currentUser.roles.includes('ADMIN');
  const editingUser = useMemo(() => users.find(user => user.id === editingUserId) || null, [editingUserId, users]);
  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')),
    [users]
  );

  const loadUsers = async () => {
    setIsLoading(true);
    setError('');
    try {
      setUsers(await authService.listUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : '员工账号加载失败');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) loadUsers();
  }, [isAdmin]);

  const resetForm = () => {
    setEditingUserId('');
    setResetUserId('');
    setResetPassword('');
    setForm(emptyForm);
  };

  const selectUser = (user: EmployeeAccount) => {
    setEditingUserId(user.id);
    setResetUserId('');
    setResetPassword('');
    setForm({
      email: user.email || '',
      username: user.username || '',
      name: user.name || '',
      password: '',
      roles: user.roles.length > 0 ? user.roles : ['CONSULTANT'],
      activeRole: user.activeRole || user.roles[0] || 'CONSULTANT',
      extraActions: (user as any).extraActions || [],
      deniedActions: (user as any).deniedActions || [],
      accountExpiresAt: (user as any).accountExpiresAt || '',
      positionTagsText: (user.positionTags || []).join('，'),
      reportsToUserId: user.reportsToUserId || '',
      status: user.status || 'active'
    });
  };

  const toggleRole = (roleId: RoleID) => {
    setForm(prev => {
      const hasRole = prev.roles.includes(roleId);
      const nextRoles = hasRole ? prev.roles.filter(item => item !== roleId) : [...prev.roles, roleId];
      const roles = nextRoles.length > 0 ? nextRoles : [roleId];
      return {
        ...prev,
        roles,
        activeRole: roles.includes(prev.activeRole) ? prev.activeRole : roles[0]
      };
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = toPayload(form);
      if (editingUserId) {
        const { password, ...updates } = payload;
        const next = await authService.updateUser(editingUserId, updates);
        setUsers(prev => prev.map(user => user.id === next.id ? next : user));
        setMessage('员工账号已更新');
      } else {
        if (!payload.password) throw new Error('新员工需要设置临时密码');
        const next = await authService.createUser(payload);
        setUsers(prev => [...prev, next]);
        setMessage('员工账号已创建');
        resetForm();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetUserId) return;
    setIsSaving(true);
    setError('');
    setMessage('');
    try {
      const next = await authService.resetPassword(resetUserId, resetPassword);
      setUsers(prev => prev.map(user => user.id === next.id ? next : user));
      setResetUserId('');
      setResetPassword('');
      setMessage('密码已重置');
    } catch (err) {
      setError(err instanceof Error ? err.message : '密码重置失败');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="border border-amber-200 bg-amber-50 rounded-lg px-4 py-3 text-sm font-bold text-amber-800">
          当前账号没有员工账号管理权限
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1600px] mx-auto">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900">员工账号</h1>
          <p className="text-sm text-gray-500 mt-1">管理员工登录账号、角色、状态与岗位标签</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={loadUsers}
            className="inline-flex items-center px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-bold text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            刷新
          </button>
          <button
            onClick={resetForm}
            className="inline-flex items-center px-3 py-2 rounded-lg bg-blue-600 text-sm font-bold text-white hover:bg-blue-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            新建员工
          </button>
        </div>
      </div>

      {(message || error) && (
        <div className={`rounded-lg px-4 py-3 text-sm font-bold ${error ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'}`}>
          {error || message}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-4 items-start">
        <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center text-sm font-black text-gray-900">
              <ShieldCheck className="w-4 h-4 mr-2 text-blue-600" />
              账号列表
            </div>
            <span className="text-xs font-bold text-gray-500">{users.length} 人</span>
          </div>
          {isLoading ? (
            <div className="h-48 flex items-center justify-center text-sm font-bold text-gray-500">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              加载中
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="px-4 py-3 text-left font-black">姓名</th>
                    <th className="px-4 py-3 text-left font-black">账号</th>
                    <th className="px-4 py-3 text-left font-black">角色</th>
                    <th className="px-4 py-3 text-left font-black">岗位</th>
                    <th className="px-4 py-3 text-left font-black">状态</th>
                    <th className="px-4 py-3 text-right font-black">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedUsers.map(user => (
                    <tr key={user.id} className={editingUserId === user.id ? 'bg-blue-50/60' : 'hover:bg-gray-50'}>
                      <td className="px-4 py-3">
                        <div className="font-bold text-gray-900 whitespace-nowrap">{user.name}</div>
                        <div className="text-xs text-gray-400 mt-0.5">{user.id}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-gray-800 whitespace-nowrap">{user.email || '-'}</div>
                        <div className="text-xs text-gray-500 mt-0.5 whitespace-nowrap">{user.username || '-'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1 min-w-[160px]">
                          {user.roles.map(role => (
                            <span key={role} className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-xs font-bold">
                              {roleName(role)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="max-w-[220px] truncate text-gray-600">{(user.positionTags || []).join('，') || '-'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <span className={`px-2 py-1 rounded-md text-xs font-black ${user.status === 'disabled' ? 'bg-gray-100 text-gray-500' : 'bg-emerald-50 text-emerald-700'}`}>
                            {user.status === 'disabled' ? '停用' : '启用'}
                          </span>
                          {user.mustChangePassword && (
                            <span className="px-2 py-1 rounded-md text-xs font-black bg-amber-50 text-amber-700">需改密</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => selectUser(user)}
                            className="px-2.5 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-bold text-gray-700 hover:bg-gray-50"
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => { setResetUserId(user.id); setResetPassword(''); setEditingUserId(''); }}
                            className="inline-flex items-center px-2.5 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-bold text-gray-700 hover:bg-gray-50"
                          >
                            <KeyRound className="w-3.5 h-3.5 mr-1" />
                            重置
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black text-gray-900">{editingUser ? '编辑员工' : '新建员工'}</h2>
            <UserPlus className="w-4 h-4 text-blue-600" />
          </div>

          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-bold text-gray-500">姓名</span>
              <input
                value={form.name}
                onChange={(event) => setForm(prev => ({ ...prev, name: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-bold text-gray-500">邮箱</span>
                <input
                  value={form.email}
                  onChange={(event) => setForm(prev => ({ ...prev, email: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-gray-500">账号</span>
                <input
                  value={form.username}
                  onChange={(event) => setForm(prev => ({ ...prev, username: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </label>
            </div>
            {!editingUser && (
              <label className="block">
                <span className="text-xs font-bold text-gray-500">临时密码</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm(prev => ({ ...prev, password: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </label>
            )}
            <div>
              <span className="text-xs font-bold text-gray-500">角色</span>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {SYSTEM_ROLES.map(role => (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => toggleRole(role.id)}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm font-bold ${form.roles.includes(role.id) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                  >
                    {role.name}
                    {form.roles.includes(role.id) && <Check className="w-4 h-4" />}
                  </button>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="text-xs font-bold text-gray-500">默认角色</span>
              <select
                value={form.activeRole}
                onChange={(event) => setForm(prev => ({ ...prev, activeRole: event.target.value as RoleID }))}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              >
                {form.roles.map(role => (
                  <option key={role} value={role}>{roleName(role)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-bold text-gray-500">账号有效期</span>
              <input
                type="date"
                value={form.accountExpiresAt}
                onChange={(event) => setForm(prev => ({ ...prev, accountExpiresAt: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
              <span className="mt-1 block text-[11px] text-gray-400">
                留空 = 永久有效。给兼职和临时合作方设一个日期，到期自动登不进来，
                <strong className="font-medium">不用记得回来手工停用</strong>。
              </span>
            </label>

            {/*
              单项权限。放在角色按钮之后：**先选角色，再微调**。
              角色是打包的，给顾问加「销售」他就连全公司合同金额一起看到了；
              实际需求经常是「她能跟线索，但看不到金额」——那就要单独加/减。
            */}
            <details className="rounded-lg border border-gray-200 bg-gray-50/60">
              <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-gray-600 select-none">
                单项权限微调
                {(form.extraActions.length > 0 || form.deniedActions.length > 0) && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                    额外 {form.extraActions.length} · 收走 {form.deniedActions.length}
                  </span>
                )}
              </summary>
              <div className="space-y-3 px-3 pb-3 pt-1">
                <p className="text-[11px] leading-relaxed text-gray-500">
                  角色已经给的不用再勾。这里只处理<strong className="font-medium">例外</strong>：
                  多给一两个，或者把角色自带的收走一个。<strong className="font-medium">收走优先于给予。</strong>
                </p>
                {ACTION_GROUPS.map(group => {
                  const codes = Object.keys(ACTION_META).filter(c => ACTION_META[c].group === group) as ActionCode[];
                  if (codes.length === 0) return null;
                  return (
                    <div key={group}>
                      <p className="mb-1 text-[11px] font-bold text-gray-400">{group}</p>
                      <div className="space-y-1">
                        {codes.map(code => {
                          const meta = ACTION_META[code];
                          // 角色自带的用灰字标出来，避免重复勾选
                          const byRole = form.roles.some(r => (ROLE_CAPABILITIES[r]?.actions || []).includes(code));
                          const extra = form.extraActions.includes(code);
                          const denied = form.deniedActions.includes(code);
                          const toggle = (list: 'extraActions' | 'deniedActions') => setForm(prev => {
                            const has = prev[list].includes(code);
                            const other = list === 'extraActions' ? 'deniedActions' : 'extraActions';
                            return {
                              ...prev,
                              [list]: has ? prev[list].filter(c => c !== code) : [...prev[list], code],
                              // 同一个动作不能既给又收，勾一边自动取消另一边
                              [other]: prev[other].filter(c => c !== code),
                            } as FormState;
                          });
                          return (
                            <div key={code} className="flex items-center gap-2 text-xs">
                              <span className={`flex-1 truncate ${denied ? 'text-red-600 line-through' : byRole || extra ? 'text-gray-800' : 'text-gray-400'}`}>
                                {meta.label}
                                {meta.risk === 'high' && <span className="ml-1 text-[10px] font-bold text-red-500">高风险</span>}
                                {byRole && <span className="ml-1 text-[10px] text-gray-400">角色自带</span>}
                              </span>
                              <button type="button" onClick={() => toggle('extraActions')}
                                className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${extra ? 'bg-blue-600 text-white' : 'bg-white text-gray-400 border border-gray-200'}`}>
                                额外给
                              </button>
                              <button type="button" onClick={() => toggle('deniedActions')}
                                className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${denied ? 'bg-red-600 text-white' : 'bg-white text-gray-400 border border-gray-200'}`}>
                                收走
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>

            <label className="block">
              <span className="text-xs font-bold text-gray-500">岗位标签</span>
              <input
                value={form.positionTagsText}
                onChange={(event) => setForm(prev => ({ ...prev, positionTagsText: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-gray-500">上级</span>
              <select
                value={form.reportsToUserId}
                onChange={(event) => setForm(prev => ({ ...prev, reportsToUserId: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              >
                <option value="">未设置</option>
                {sortedUsers.filter(user => user.id !== editingUserId).map(user => (
                  <option key={user.id} value={user.id}>{user.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-bold text-gray-500">状态</span>
              <select
                value={form.status}
                onChange={(event) => setForm(prev => ({ ...prev, status: event.target.value as FormState['status'] }))}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              >
                <option value="active">启用</option>
                <option value="disabled">停用</option>
              </select>
            </label>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="w-full inline-flex items-center justify-center px-3 py-2.5 rounded-lg bg-slate-900 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              保存
            </button>
          </div>

          {resetUserId && (
            <div className="border-t border-gray-100 pt-4 space-y-3">
              <div className="text-sm font-black text-gray-900">重置密码</div>
              <input
                type="password"
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
              <button
                onClick={handleResetPassword}
                disabled={isSaving}
                className="w-full inline-flex items-center justify-center px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                <KeyRound className="w-4 h-4 mr-2" />
                确认重置
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

export default Employees;
