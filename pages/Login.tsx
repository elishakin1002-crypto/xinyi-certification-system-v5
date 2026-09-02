import React, { useState } from 'react';
import { LockKeyhole, Loader2, LogIn, ShieldCheck, User } from 'lucide-react';
import { authService, AuthUser } from '../services/authService';

type LoginProps = {
  onLogin: (user: AuthUser) => void;
};

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!account.trim() || !password) {
      setError('请输入账号和密码');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const result = await authService.login(account.trim(), password);
      onLogin(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-900 flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-[1fr_420px] bg-white rounded-3xl overflow-hidden shadow-2xl border border-white/10">
        <div className="hidden lg:flex flex-col justify-between bg-slate-900 text-white p-10">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-blue-600 flex items-center justify-center text-xl font-black">X</div>
              <div>
                <div className="text-2xl font-black">信义 V5.0</div>
                <div className="text-xs text-slate-400 mt-1">内部管理系统</div>
              </div>
            </div>
            <div className="mt-16">
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-500/10 px-3 py-1 text-xs font-bold text-blue-200">
                <ShieldCheck className="w-4 h-4" />
                员工认证入口
              </div>
              <h1 className="text-4xl font-black leading-tight mt-6">登录后进入工作台、线索、合同、项目与财务闭环。</h1>
            </div>
          </div>
          <div className="text-xs text-slate-500">app.xinyi-iso.com</div>
        </div>

        <div className="p-8 md:p-10">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-black">X</div>
            <div>
              <div className="text-xl font-black text-slate-900">信义 V5.0</div>
              <div className="text-xs text-slate-500">内部管理系统</div>
            </div>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-black text-slate-900">员工登录</h2>
            <p className="text-sm text-slate-500 mt-2">使用管理员分配的员工账号进入管理系统。</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <label className="block">
              <span className="text-xs font-black text-slate-500 uppercase tracking-wider">账号</span>
              <div className="mt-2 relative">
                <User className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  autoComplete="username"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3.5 pl-12 pr-4 text-sm font-bold outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                  value={account}
                  onChange={(event) => setAccount(event.target.value)}
                  placeholder="员工邮箱或账号"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-black text-slate-500 uppercase tracking-wider">密码</span>
              <div className="mt-2 relative">
                <LockKeyhole className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  autoComplete="current-password"
                  type="password"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3.5 pl-12 pr-4 text-sm font-bold outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="请输入密码"
                />
              </div>
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
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <><LogIn className="w-5 h-5 mr-2" /> 登录</>}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;
