import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, Save, ShieldCheck } from 'lucide-react';
import { authService, AuthUser } from '../services/authService';

type ChangePasswordProps = {
  user: AuthUser;
  onChanged: (user: AuthUser) => void;
};

const ChangePassword: React.FC<ChangePasswordProps> = ({ user, onChanged }) => {
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
    if (newPassword !== confirmPassword) {
      setError('两次新密码不一致');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const result = await authService.changePassword(currentPassword, newPassword);
      onChanged(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '密码修改失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-900 flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-white/10 p-8">
        <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center mb-6">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <h1 className="text-2xl font-black text-slate-900">首次登录修改密码</h1>
        <p className="text-sm text-slate-500 mt-2">
          {user.name}，请先修改临时密码后进入系统。
        </p>

        <form onSubmit={handleSubmit} className="space-y-4 mt-8">
          <div className="flex justify-end -mb-1">
            <button
              type="button"
              onClick={() => setShowPasswords((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-100"
            >
              {showPasswords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {showPasswords ? '隐藏密码' : '显示密码'}
            </button>
          </div>
          <label className="block">
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider">当前密码</span>
            <div className="mt-2 relative">
              <KeyRound className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                autoComplete="current-password"
                type={showPasswords ? 'text' : 'password'}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3.5 pl-12 pr-4 text-sm font-bold outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                placeholder="请输入当前密码"
              />
            </div>
          </label>
          <label className="block">
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider">新密码</span>
            <input
              autoComplete="new-password"
              type={showPasswords ? 'text' : 'password'}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 py-3.5 px-4 text-sm font-bold outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="至少 8 位"
            />
          </label>
          <label className="block">
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider">确认新密码</span>
            <input
              autoComplete="new-password"
              type={showPasswords ? 'text' : 'password'}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 py-3.5 px-4 text-sm font-bold outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
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
