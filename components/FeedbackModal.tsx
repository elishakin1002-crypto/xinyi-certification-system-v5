import React, { useState } from 'react';
import { MessageSquare, X, Send, Loader2, CheckCircle2 } from 'lucide-react';

/**
 * 问题反馈弹窗。
 *
 * ── 为什么是表单，不是一个大文本框 ────────────────────────────
 * 让人自由描述，收到的会是「合同那里有问题」「点了没反应」这种。
 * 看的人要来回追问三轮才知道说的是什么，而追问的成本高到最后就不追了 ——
 * 反馈渠道名存实亡。
 *
 * 表单替人问出三件事：**想做什么 / 结果怎么样 / 在哪一页**。
 * 第三件自动填。
 *
 * ── 30 秒能填完，否则没人填 ───────────────────────────────────
 * 人是在干活被卡住的时候来填这个的，本来就烦。
 * 每多一个必填项，就少一批愿意填的人。
 * 所以：两个选择题（点一下）+ 两个短输入框，其余全部自动带。
 *
 * ── 分类为什么必须是选的 ──────────────────────────────────────
 * 「我不知道该怎么操作」这一类如果不单列出来，人就不会提 ——
 * 他会以为是自己笨。而这类恰恰最有价值：**它说的是设计问题，
 * 不是使用者的问题**，而且一个人不会用，通常意味着还有几个人不会用但没说。
 */

type Kind = 'bug' | 'confused' | 'wrong' | 'improve';
type Severity = 'blocked' | 'annoying' | 'later';

const KINDS: Array<{ id: Kind; label: string; hint: string }> = [
  { id: 'bug', label: '系统出错了', hint: '报错、白屏、点了没反应' },
  { id: 'confused', label: '我不知道怎么操作', hint: '找不到入口、不确定该填什么' },
  { id: 'wrong', label: '能用，但结果不对', hint: '数字对不上、显示的不是我要的' },
  { id: 'improve', label: '希望这样改', hint: '现在能用，但很别扭' },
];

const SEVERITIES: Array<{ id: Severity; label: string }> = [
  { id: 'blocked', label: '挡住干活了' },
  { id: 'annoying', label: '能绕过去，但烦' },
  { id: 'later', label: '不急' },
];

type Props = { open: boolean; onClose: () => void };

const FeedbackModal: React.FC<Props> = ({ open, onClose }) => {
  const [kind, setKind] = useState<Kind>('bug');
  const [severity, setSeverity] = useState<Severity>('annoying');
  const [intent, setIntent] = useState('');
  const [actual, setActual] = useState('');
  const [expected, setExpected] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const reset = () => {
    setKind('bug'); setSeverity('annoying');
    setIntent(''); setActual(''); setExpected('');
    setDone(false); setError('');
  };

  const submit = async () => {
    if (!intent.trim() && !actual.trim()) {
      setError('至少说一下你想做什么，或者结果怎么样了');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          kind, severity, intent, actual, expected,
          // 页面地址自动带上。让人自己描述「我在哪个页面」既费事又常常说不准
          route: String(window.location.hash || ''),
          appVersion: 'v5.0',
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.ok === false) throw new Error(body?.message || `提交失败（HTTP ${res.status}）`);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  };

  const close = () => { reset(); onClose(); };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[60]" onClick={close} />
      <div className="fixed inset-0 z-[61] flex items-center justify-center p-4 pointer-events-none">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl pointer-events-auto max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-blue-600" />
              <h3 className="text-base font-black text-gray-900">反馈问题</h3>
            </div>
            <button type="button" onClick={close} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100">
              <X className="w-5 h-5" />
            </button>
          </div>

          {done ? (
            <div className="px-5 py-10 text-center">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
              <p className="text-sm font-bold text-gray-900 mt-4">收到了，谢谢</p>
              <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
                管理员会看到。处理完会在这里给你回复。
              </p>
              <button
                type="button" onClick={close}
                className="mt-6 px-5 h-10 rounded-xl bg-gray-100 text-sm font-bold text-gray-700 hover:bg-gray-200"
              >
                关闭
              </button>
            </div>
          ) : (
            <div className="px-5 py-4 space-y-4">
              <div>
                <p className="text-xs font-black text-gray-500 mb-2">是哪一类？</p>
                <div className="grid grid-cols-2 gap-2">
                  {KINDS.map(k => (
                    <button
                      key={k.id} type="button" onClick={() => setKind(k.id)}
                      className={`text-left px-3 py-2.5 rounded-xl border transition-colors ${
                        kind === k.id
                          ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/15'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <p className={`text-sm font-bold ${kind === k.id ? 'text-blue-700' : 'text-gray-800'}`}>{k.label}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">{k.hint}</p>
                    </button>
                  ))}
                </div>
              </div>

              <label className="block">
                <span className="text-xs font-black text-gray-500">你当时想做什么？</span>
                <input
                  value={intent} onChange={e => setIntent(e.target.value)}
                  placeholder="例：想给「浙江xx包装」录一份新合同"
                  className="mt-1.5 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:bg-white"
                />
              </label>

              <label className="block">
                <span className="text-xs font-black text-gray-500">结果怎么样了？</span>
                <input
                  value={actual} onChange={e => setActual(e.target.value)}
                  placeholder="例：点保存之后转圈，等了半分钟还是那个页面"
                  className="mt-1.5 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:bg-white"
                />
              </label>

              {/* 只有「希望这样改」才问期望——其他类型问了是噪音，也拖慢填写 */}
              {kind === 'improve' && (
                <label className="block">
                  <span className="text-xs font-black text-gray-500">你希望它变成什么样？</span>
                  <input
                    value={expected} onChange={e => setExpected(e.target.value)}
                    placeholder="例：希望能一次选多个客户批量发提醒"
                    className="mt-1.5 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:bg-white"
                  />
                </label>
              )}

              <div>
                <p className="text-xs font-black text-gray-500 mb-2">急吗？</p>
                <div className="flex gap-2">
                  {SEVERITIES.map(s => (
                    <button
                      key={s.id} type="button" onClick={() => setSeverity(s.id)}
                      className={`flex-1 px-2 py-2 rounded-xl border text-xs font-bold transition-colors ${
                        severity === s.id
                          ? 'border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-500/15'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-[11px] text-gray-400 leading-relaxed">
                会自动带上你的名字、当前页面和浏览器信息，不用你填。
              </p>

              {error && (
                <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs font-bold text-red-700">
                  {error}
                </div>
              )}

              <button
                type="button" onClick={submit} disabled={submitting}
                className="w-full h-11 rounded-xl bg-blue-600 text-white text-sm font-black hover:bg-blue-700 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                提交
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default FeedbackModal;
