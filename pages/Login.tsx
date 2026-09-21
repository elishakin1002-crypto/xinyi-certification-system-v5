import React, { useState } from 'react';
import { Eye, EyeOff, LockKeyhole, Loader2, LogIn, ShieldCheck, User } from 'lucide-react';
import { authService, AuthUser } from '../services/authService';

type LoginProps = {
  onLogin: (user: AuthUser) => void;
};

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  /*
    默认勾上：信义办公室基本一人一台电脑，天天早上重登纯属添堵 ——
    而添堵的实际结果通常是把密码写在便签上贴在显示器边，那更不安全。
    公用电脑请手动取消，下面那行小字说明了。
  */
  const [remember, setRemember] = useState(true);
  /*
    初始密码是随机 12 位，同事得照着纸条或微信里的一串字符敲。
    敲错了看到的只有一排圆点，只能整行删掉重来 ——
    连着两三次就会怀疑是不是密码本身错了，然后来问。
    给一个能看一眼的开关，比什么都省事。默认仍然是隐藏的。
  */
  const [showPassword, setShowPassword] = useState(false);
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
      const result = await authService.login(account.trim(), password, remember);
      onLogin(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-900 flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-[1fr_420px] bg-white rounded-3xl overflow-hidden shadow-2xl border border-white/10">
        <div className="hidden lg:flex flex-col justify-between bg-gray-900 text-white p-10">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-blue-600 flex items-center justify-center text-xl font-black">X</div>
              <div>
                <div className="text-2xl font-black">信义 V5.0</div>
                <div className="text-xs text-gray-400 mt-1">内部管理系统</div>
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
          {/*
            显示**当前真实的**访问地址，不写死域名。

            2026-09-10：这里原来印着 `app.xinyi-iso.com` —— 那个域名
            至今没有任何 DNS 记录，输进去打不开。金恩来自己就照着它试过。
            13 个同事铺开时会照着屏幕上这行字去输，然后集体打不开，
            而他们多半不会来问，只会觉得「这系统又坏了」。

            登录页上的地址是**要被人抄下来、发到群里**的东西，
            所以它必须是此刻真的能用的那个，而不是我们希望将来是的那个。
            域名和 HTTPS 都办好之后，这里会自动跟着变，不用再改代码。
          */}
          <div className="text-xs text-gray-500">
            {typeof window !== 'undefined' ? window.location.host : ''}
          </div>
        </div>

        <div className="p-8 md:p-10">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-black">X</div>
            <div>
              <div className="text-xl font-black text-gray-900">信义 V5.0</div>
              <div className="text-xs text-gray-500">内部管理系统</div>
            </div>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-black text-gray-900">员工登录</h2>
            <p className="text-sm text-gray-500 mt-2">使用管理员分配的员工账号进入管理系统。</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <label className="block">
              <span className="text-xs font-black text-gray-500 uppercase tracking-wider">账号</span>
              <div className="mt-2 relative">
                <User className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  autoComplete="username"
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50 py-3.5 pl-12 pr-4 text-sm font-bold outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                  value={account}
                  onChange={(event) => setAccount(event.target.value)}
                  placeholder="员工邮箱或账号"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-black text-gray-500 uppercase tracking-wider">密码</span>
              <div className="mt-2 relative">
                <LockKeyhole className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  autoComplete="current-password"
                  type={showPassword ? 'text' : 'password'}
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50 py-3.5 pl-12 pr-12 text-sm font-bold outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="请输入密码"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  // type="button" 是必须的：form 里的 button 默认 type="submit"，
                  // 不写的话点一下眼睛就直接提交登录了。
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  title={showPassword ? '隐藏密码' : '显示密码'}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-200/60"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </label>

            {/*
              这一项直接决定「离开工位之后别人能不能进」，
              所以写清楚是多久、什么时候该取消，而不是一句「记住我」。
            */}
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500/30"
              />
              <span className="text-xs font-bold leading-relaxed text-gray-500">
                这台电脑我常用，14 天内免登录
                <span className="block font-medium text-gray-400">
                  公用电脑请取消勾选 —— 不勾的话离开 12 小时就要重新登录。
                </span>
              </span>
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
