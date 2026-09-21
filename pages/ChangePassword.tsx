import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, Save, ShieldCheck } from 'lucide-react';
import { authService, AuthUser } from '../services/authService';

/*
  ── 这一页有两种来法（2026-09-13）──────────────────────────────

  金恩来：「我登录 admin 时没有提示要我修改密码，这还不是关键，
           关键是我自己要去修改密码也没有这个入口。」

  原来这一页只在 mustChangePassword=true 时挂出来（首次登录强制改），
  改完这个标记就没了，**这一页从此再也进不去** ——
  于是「我想主动换个密码」在全系统里没有任何入口。

  现在同一个表单两种用法：
  · forced：首次登录被拦在这里，改完才能进系统（原行为，不动）
  · self ：账号菜单里点进来的，随时可改，改完回工作台

  为什么不做成两个页面：两边的校验、显示密码开关、错误文案完全一样，
  拆开必然有一边先过期。差别只有标题和改完去哪，用一个 variant 区分就够。
*/
type ChangePasswordProps = {
  user: AuthUser;
  onChanged: (user: AuthUser) => void;
  variant?: 'forced' | 'self';
  onDone?: () => void;
};

const ChangePassword: React.FC<ChangePasswordProps> = ({ user, onChanged, variant = 'forced', onDone }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  /*
    这一页比登录页更需要能看见。
    同事是第一次登录被强制跳过来的：上面要照抄一串随机初始密码，
    下面要自己想一个再确认一遍。三个框全是圆点，
    最常见的失败是「新密码和确认不一致」—— 而屏幕上没有任何线索能看出差在哪。

    一个开关同时控制三个框，而不是每个框各一个眼睛：
    要解决的正是「两个框对不对得上」，分开切换反而不好比。
  */
  const [showPasswords, setShowPasswords] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentPassword || !newPassword) {
      setError('请输入当前密码和新密码');
      return;
    }
    if (newPassword.length < 8) {
      setError('新密码至少 8 位');
      return;
    }
    if (newPassword === currentPassword) {
      setError('新密码和当前密码一样，等于没改');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次新密码不一致');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const result = await authService.changePassword(currentPassword, newPassword);
      onChanged(result.user);
      if (variant === 'self') {
        /*
          主动改密码的人**刚刚亲手输了新密码**，最需要的一句话是
          「存上了，下次用新的」——而不是页面一闪就跳走，
          让人怀疑到底改没改成。停在这里，由他自己点回去。
        */
        setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
        setDone(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '密码修改失败');
    } finally {
      setSubmitting(false);
    }
  };

  const isSelf = variant === 'self';

  return (
    <div className={isSelf
      ? 'px-4 md:px-6 py-6 flex justify-center'
      : 'min-h-screen bg-gray-950 text-gray-900 flex items-center justify-center px-6 py-10'}>
      <div className={isSelf
        ? 'w-full max-w-md bg-white rounded-3xl shadow-sm border border-gray-200 p-8'
        : 'w-full max-w-md bg-white rounded-3xl shadow-2xl border border-white/10 p-8'}>
        <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center mb-6">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <h1 className="text-2xl font-black text-gray-900">{isSelf ? '修改密码' : '首次登录修改密码'}</h1>
        <p className="text-sm text-gray-500 mt-2">
          {isSelf
            ? `${user.name}，改完之后请用新密码登录；其他设备上已登录的会话不受影响，要踢掉去「我的登录设备」。`
            : `${user.name}，请先修改临时密码后进入系统。`}
        </p>

        {done && (
          <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
            新密码已生效，下次登录请用新密码。
            {onDone && (
              <button type="button" onClick={onDone} className="ml-2 underline underline-offset-2">
                返回工作台
              </button>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 mt-8">
          <div className="flex justify-end -mb-1">
            <button
              type="button"
              onClick={() => setShowPasswords((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100"
            >
              {showPasswords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {showPasswords ? '隐藏密码' : '显示密码'}
            </button>
          </div>
          <label className="block">
            <span className="text-xs font-black text-gray-500 uppercase tracking-wider">当前密码</span>
            <div className="mt-2 relative">
              <KeyRound className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                autoComplete="current-password"
                type={showPasswords ? 'text' : 'password'}
                className="w-full rounded-2xl border border-gray-200 bg-gray-50 py-3.5 pl-12 pr-4 text-sm font-bold outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                placeholder="请输入当前密码"
              />
            </div>
          </label>
          <label className="block">
            <span className="text-xs font-black text-gray-500 uppercase tracking-wider">新密码</span>
            <input
              autoComplete="new-password"
              type={showPasswords ? 'text' : 'password'}
              className="mt-2 w-full rounded-2xl border border-gray-200 bg-gray-50 py-3.5 px-4 text-sm font-bold outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="至少 8 位"
            />
          </label>
          <label className="block">
            <span className="text-xs font-black text-gray-500 uppercase tracking-wider">确认新密码</span>
            <input
              autoComplete="new-password"
              type={showPasswords ? 'text' : 'password'}
              className="mt-2 w-full rounded-2xl border border-gray-200 bg-gray-50 py-3.5 px-4 text-sm font-bold outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="再次输入新密码"
            />
          </label>

          {error && (
            <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-12 rounded-2xl bg-blue-600 text-white text-sm font-black shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70 flex items-center justify-center"
          >
            {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Save className="w-5 h-5 mr-2" /> 保存新密码</>}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChangePassword;
