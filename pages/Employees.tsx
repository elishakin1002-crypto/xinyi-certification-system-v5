import React, { useEffect, useMemo, useState } from 'react';
import { Check, KeyRound, Loader2, Plus, RefreshCw, Save, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
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
  const { currentUser, checkActionPermission } = useApp();
  const [users, setUsers] = useState<EmployeeAccount[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingUserId, setEditingUserId] = useState('');
  const [resetUserId, setResetUserId] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  /** 待确认删除的账号。删除不可撤销，所以一定要走一次确认 */
  const [pendingDelete, setPendingDelete] = useState<EmployeeAccount | null>(null);
  const [togglingId, setTogglingId] = useState('');
  /*
    ── 默认不显示已停用的人（2026-09-05）────────────────────

    离职的人删不掉（他名下的操作记录还要能查出是谁做的），
    所以停用的账号会一直留在库里。人员流动几年下来，
    名单里一半是已经不在的人 —— 每次找人都要多扫一遍。

    删掉不是办法（审计链会断），**不显示就够了**：
    需要时一键看全部，日常眼不见为净。
  */
  const [showDisabled, setShowDisabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  /*
    ── 系统管理员必须能管账号（2026-09-04 修）────────────────────

    原来只认 ADMIN（总经理）。于是系统管理员打开员工账号页看到的是
    「当前账号没有员工账号管理权限」——**而管账号正是他的本职工作**：
    新人入职开号、离职停用、有人忘密码重置、查审计日志。

    服务端一直是放行的（SYS_ADMIN 的能力清单里有 EMPLOYEE_* 全套，
    /api/auth/users 实测返回 200），只有前端这一行在拦。
    结果是「后端给了权限、前端不让点」——这种不一致最难查，
    因为看日志一切正常。
  */
  /*
    按**动作**判断，不再列角色名单。

    这里先后写错过两次：一次是 roles.includes('ADMIN')，把系统管理员
    挡在门外；改成 ADMIN||SYS_ADMIN 之后，给总助加权限时又得回来改一遍。
    权限矩阵里已经有 EMPLOYEE_VIEW 了，这里再维护一份角色名单，
    两份迟早对不上 —— 而对不上的表现就是「服务端放行、界面说没权限」。
  */
  const isAdmin = checkActionPermission('EMPLOYEE_VIEW').allowed;
  const editingUser = useMemo(() => users.find(user => user.id === editingUserId) || null, [editingUserId, users]);
  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')),
    [users]
  );
  const disabledCount = sortedUsers.filter(u => u.status === 'disabled').length;
  const visibleUsers = showDisabled ? sortedUsers : sortedUsers.filter(u => u.status !== 'disabled');

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

  /*
    删除账号。

    界面上**不预判**能不能删 —— 判断依据在服务端（有没有操作记录、
    有没有名下的合同项目），前端拿不到，猜一个只会猜错。
    所以按钮一直显示，删不掉时把服务端那句解释原样显示出来：
    「这个账号名下还有 X 条…请改用停用」。
    人看到的是原因，不是一个灰掉的按钮。
  */
  /*
    行内直接停用/启用。

    2026-09-05 之前，停用一个人要：找到那一行 → 点编辑 → 在右边表单里
    翻到「状态」→ 选停用 → 保存。五步，而且中间任何一步走岔了
    （比如没点编辑就去改表单）都毫无提示。

    离职停用是这个页面上最常做的一件事，它该是一下点完的。
  */
  const toggleStatus = async (user: EmployeeAccount) => {
    const next = user.status === 'disabled' ? 'active' : 'disabled';
    setTogglingId(user.id);
    setError('');
    setMessage('');
    try {
      const saved = await authService.updateUser(user.id, { status: next });
      setUsers(prev => prev.map(u => (u.id === saved.id ? saved : u)));
      setMessage(next === 'disabled'
        ? `${user.name} 已停用 —— 他登不进来了，做过的记录都还在`
        : `${user.name} 已恢复启用`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '状态修改失败');
    } finally {
      setTogglingId('');
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setIsSaving(true);
    setError('');
    setMessage('');
    try {
      await authService.deleteUser(pendingDelete.id);
      setUsers(prev => prev.filter(u => u.id !== pendingDelete.id));
      setMessage(`账号 ${pendingDelete.name} 已删除`);
      setPendingDelete(null);
      if (editingUserId === pendingDelete.id) resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
      setPendingDelete(null);
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
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-gray-500">
                {visibleUsers.length} 人{disabledCount > 0 && !showDisabled ? `（另有 ${disabledCount} 个已停用）` : ''}
              </span>
              {disabledCount > 0 && (
                <button
                  onClick={() => setShowDisabled(v => !v)}
                  className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-bold text-gray-600 hover:bg-gray-50"
                >
                  {showDisabled ? '只看在职' : '显示已停用'}
                </button>
              )}
            </div>
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
                    {/*
                      「操作」列钉在右边。

                      2026-09-05 反馈「cheshi 找不到删除键」—— 原因不是没有按钮，
                      是这一列被挤到了屏幕外：表格比可视区宽，横向滚动条又不显眼，
                      人根本不知道右边还有东西。**够不到的按钮等于不存在。**
                    */}
                    <th className="sticky right-0 z-10 bg-gray-50 px-4 py-3 text-right font-black shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.12)]">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {/* 整行都能点开编辑 —— 小按钮不是每个人都会去找 */}
                  {visibleUsers.map(user => (
                    <tr
                      key={user.id}
                      onClick={() => selectUser(user)}
                      title="点这一行编辑该账号"
                      className={`cursor-pointer ${editingUserId === user.id ? 'bg-blue-50/60' : 'hover:bg-gray-50'}`}
                    >
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
                      <td className={`sticky right-0 z-10 px-4 py-3 text-right shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.12)] ${
                        editingUserId === user.id ? 'bg-blue-50' : 'bg-white'
                      }`}>
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); selectUser(user); }}
                            className="px-2.5 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-bold text-gray-700 hover:bg-gray-50"
                          >
                            编辑
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setResetUserId(user.id); setResetPassword(''); setEditingUserId(''); }}
                            className="inline-flex items-center px-2.5 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-bold text-gray-700 hover:bg-gray-50"
                          >
                            <KeyRound className="w-3.5 h-3.5 mr-1" />
                            重置
                          </button>
                          {/* 停用/启用直接在这一行点完，不用绕表单 */}
                          {user.id !== currentUser.id && (
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleStatus(user); }}
                              disabled={togglingId === user.id}
                              className={`inline-flex items-center px-2.5 py-1.5 rounded-md border text-xs font-bold disabled:opacity-60 ${
                                user.status === 'disabled'
                                  ? 'border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50'
                                  : 'border-gray-200 bg-white text-gray-600 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-200'
                              }`}
                            >
                              {togglingId === user.id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : user.status === 'disabled' ? '启用' : '停用'}
                            </button>
                          )}
                          {/* 不给自己显示删除键 —— 删完当场登不进来，而且这几乎总是误点 */}
                          {user.id !== currentUser.id && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setPendingDelete(user); }}
                              title="只能删除从没产生过任何记录的账号"
                              className="inline-flex items-center px-2.5 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-bold text-gray-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="bg-white border border-gray-200 rounded-lg space-y-4 pb-4">
          {/*
            ── 这一条必须钉住（2026-09-05）──────────────────────

            反馈：「选了 cheshi，然后选停用，没有发生任何变化」。
            实际发生的是：面板停在「新建员工」状态，他在**上级**下拉里
            选了 cheshi —— 也就是在给一个还不存在的新账号指定上级，
            而不是在编辑 cheshi。

            标题本来就写着「新建员工」，但表单一长，往下滚两下标题就滚没了，
            剩下的界面对「在编谁」这件事**一个字都没说**。
            所以现在钉在顶部，并且把名字直接写出来。
          */}
          <div className={`sticky top-0 z-10 flex items-center justify-between gap-2 rounded-t-lg border-b px-4 py-3 ${
            editingUser ? 'bg-blue-50 border-blue-100' : 'bg-gray-50 border-gray-100'
          }`}>
            <div className="min-w-0">
              <h2 className="text-sm font-black text-gray-900 truncate">
                {editingUser ? `正在编辑：${editingUser.name}` : '新建员工'}
              </h2>
              <p className="text-[11px] font-bold text-gray-500 mt-0.5 truncate">
                {editingUser
                  ? (editingUser.username || editingUser.email || editingUser.id)
                  : '填完保存会新增一个账号，不会改到现有的人'}
              </p>
            </div>
            {editingUser ? (
              <button
                onClick={resetForm}
                className="shrink-0 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50"
              >
                取消编辑
              </button>
            ) : (
              <UserPlus className="w-4 h-4 shrink-0 text-blue-600" />
            )}
          </div>

          <div className="px-4">

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
            {/*
              新建时不显示「状态」：新账号一定是启用的。
              留着它的唯一效果，是让人以为「选个停用就能把某人停掉」——
              而那一刻他其实在建一个一出生就停用的新账号。
            */}
            <label className={editingUser ? 'block' : 'hidden'}>
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
          </div>
        </aside>
      </div>

      {/*
        删除确认。

        写清楚**会发生什么**和**什么时候该用停用**，而不是干巴巴问一句
        「确定删除吗？」—— 那种提示所有人都是闭着眼点确定的。
      */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="text-sm font-black text-gray-900">删除账号</div>
            </div>
            <div className="px-5 py-4 space-y-3 text-sm text-gray-700 leading-relaxed">
              <p>
                将要删除 <span className="font-black text-gray-900">{pendingDelete.name}</span>
                （{pendingDelete.username || pendingDelete.email}）。
              </p>
              <p className="text-xs text-gray-500">
                只有<span className="font-bold">从没产生过任何记录</span>的账号能删 ——
                建错的测试号属于这种。已经干过活的账号会被拒绝，
                因为删掉之后他做过的事就查不出是谁做的了；
                那种情况请改用「停用」：人进不来，历史还在。
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3.5 bg-gray-50 border-t border-gray-100">
              <button
                onClick={() => setPendingDelete(null)}
                className="px-3 h-9 rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-200"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                disabled={isSaving}
                className="inline-flex items-center px-4 h-9 rounded-lg bg-red-600 text-white text-xs font-black hover:bg-red-700 disabled:opacity-60"
              >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-1.5" />}
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Employees;
