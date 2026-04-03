
import React, { useEffect, useMemo, useState } from 'react';
import { ToggleLeft, ToggleRight, Sliders, AlertCircle, ShieldCheck, Lock, EyeOff, FileKey, Activity, Database, ArrowRight, Users, Plus, Trash2, Save } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { RoleID, UserProfile } from '../types';
import { SYSTEM_ROLES } from '../constants';

const AICenter = () => {
  const [piiMasking, setPiiMasking] = useState(true);
  const [auditLog, setAuditLog] = useState(true);
  const [dataRetention, setDataRetention] = useState(false);
  const [activePanel, setActivePanel] = useState<'training-data' | 'model-status' | 'security' | 'members' | ''>('');
  const [dashboardFocusLabel, setDashboardFocusLabel] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const { userProfiles, updateUserProfile, addUserProfile, deleteUserProfile } = useApp();
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [newUser, setNewUser] = useState<UserProfile>({
    id: '',
    name: '',
    roles: ['CONSULTANT'],
    activeRole: 'CONSULTANT',
    positionTags: []
  });

  const sortedUsers = useMemo(() => {
    return [...userProfiles].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }, [userProfiles]);

  const roleOptions: { id: RoleID; name: string }[] = SYSTEM_ROLES.map(r => ({ id: r.id, name: r.name }));
  const reportsToOptions = useMemo(() => {
    return [...userProfiles].map(u => ({ id: u.id, name: u.name })).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }, [userProfiles]);

  const toggleRole = (u: UserProfile, role: RoleID) => {
    const roles = u.roles.includes(role) ? u.roles.filter(r => r !== role) : [...u.roles, role];
    if (roles.length === 0) return;
    updateUserProfile(u.id, { roles });
  };

  const parseTags = (text: string) => {
    const tags = text.split(/[，,]/).map(s => s.trim()).filter(Boolean);
    return Array.from(new Set(tags));
  };

  useEffect(() => {
    const state: any = location.state || {};
    const panelFromState = String(state.dashboardFocus?.panel || '').trim();
    const panelFromQuery = String(new URLSearchParams(location.search).get('panel') || '').trim();
    const nextPanel = (panelFromState || panelFromQuery) as 'training-data' | 'model-status' | 'security' | 'members' | '';
    if (!nextPanel) return;
    setActivePanel(nextPanel);
    if (nextPanel === 'training-data') setDashboardFocusLabel('AI 训练数据');
    else if (nextPanel === 'model-status') setDashboardFocusLabel('模型状态与运行健康度');
    else if (nextPanel === 'security') setDashboardFocusLabel('安全与隐私策略');
    else if (nextPanel === 'members') setDashboardFocusLabel('成员与岗位治理');

    if (state.dashboardFocus) {
      window.history.replaceState({}, document.title);
    }
  }, [location.state, location.search]);

  return (
    <div className="p-6">
       <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">AI 配置与安全中心</h1>
            <p className="text-sm text-gray-500 mt-1">管理模型策略、数据隐私保护与合规性审计</p>
      </div>
      {dashboardFocusLabel && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700">
            工作台焦点：{dashboardFocusLabel}
          </span>
          <button
            type="button"
            onClick={() => {
              setActivePanel('');
              setDashboardFocusLabel('');
            }}
            className="text-xs font-bold text-gray-500 hover:text-gray-700"
          >
            清除焦点
          </button>
        </div>
      )}

      {/* Quick Action for Training Data */}
      <div 
        onClick={() => navigate('/knowledge', { state: { dashboardFocus: { type: 'ai_ready' } } })}
        className={`bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl p-6 text-white mb-6 flex justify-between items-center cursor-pointer shadow-lg hover:shadow-xl transition-shadow ${activePanel === 'training-data' ? 'ring-2 ring-indigo-300 ring-offset-2' : ''}`}
      >
          <div className="flex items-center">
              <div className="p-3 bg-white/20 rounded-lg mr-4">
                  <Database className="w-6 h-6 text-white" />
              </div>
              <div>
                  <h3 className="text-lg font-bold">管理 AI 训练数据</h3>
                  <p className="text-indigo-100 text-sm opacity-90">想让 AI 更懂公司业务？请前往知识中心上传资料。</p>
              </div>
          </div>
          <ArrowRight className="w-6 h-6 text-white" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Status Panel */}
          <div className={`bg-white p-6 rounded-xl shadow-sm border ${activePanel === 'model-status' ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-gray-100'}`}>
              <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
                  <Activity className="w-5 h-5 mr-2 text-blue-600" />
                  系统健康度与模型状态
              </h3>
              <div className="space-y-4">
                  <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg border border-green-100">
                      <div>
                          <p className="font-medium text-gray-900 flex items-center">
                              <ShieldCheck className="w-4 h-4 mr-1 text-green-600" /> 
                              企业级数据保护
                          </p>
                          <p className="text-xs text-gray-500">Moonshot Kimi API (供应商侧合规能力可选)</p>
                      </div>
                      <div className="text-green-600 text-xs font-bold px-2 py-1 bg-white rounded border border-green-200">
                          已激活
                      </div>
                  </div>
                  
                  <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                      <div>
                          <p className="font-medium text-gray-900">合同分析模型</p>
                          <p className="text-xs text-gray-500">Kimi K2.5 (Moonshot / 国内可用)</p>
                      </div>
                      <div className="flex items-center space-x-2">
                          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                          <span className="text-gray-600 text-sm font-medium">运行中</span>
                      </div>
                  </div>
                  
                  <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                      <div>
                          <p className="font-medium text-gray-900">语音识别引擎</p>
                          <p className="text-xs text-gray-500">Web Speech API (本地处理)</p>
                      </div>
                      <div className="flex items-center space-x-2">
                          <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                          <span className="text-gray-600 text-sm font-medium">就绪</span>
                      </div>
                  </div>
              </div>
          </div>

          {/* Security & Compliance Configuration */}
          <div className={`bg-white p-6 rounded-xl shadow-sm border ${activePanel === 'security' ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-gray-100'}`}>
              <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
                  <Lock className="w-5 h-5 mr-2 text-indigo-600" />
                  安全与隐私策略 (Security Policy)
              </h3>
              
              <div className="space-y-6">
                  {/* PII Masking Toggle */}
                  <div className="flex items-center justify-between group">
                      <div>
                          <p className="font-medium text-gray-900 flex items-center">
                              <EyeOff className="w-4 h-4 mr-2 text-gray-500" />
                              敏感信息自动脱敏 (PII Masking)
                          </p>
                          <p className="text-xs text-gray-500 mt-1 max-w-xs">
                              在发送给 AI 前，自动将身份证、手机号、银行卡号替换为掩码，处理完成后还原。
                          </p>
                      </div>
                      <button onClick={() => setPiiMasking(!piiMasking)}>
                          {piiMasking ? <ToggleRight className="w-10 h-10 text-indigo-600" /> : <ToggleLeft className="w-10 h-10 text-gray-300" />}
                      </button>
                  </div>

                  {/* Audit Log Toggle */}
                  <div className="flex items-center justify-between group">
                      <div>
                          <p className="font-medium text-gray-900 flex items-center">
                              <FileKey className="w-4 h-4 mr-2 text-gray-500" />
                              AI 调用审计日志 (Audit Logs)
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                              记录所有 AI 交互的 Input/Output 用于合规审查，保留期 180 天。
                          </p>
                      </div>
                      <button onClick={() => setAuditLog(!auditLog)}>
                          {auditLog ? <ToggleRight className="w-10 h-10 text-indigo-600" /> : <ToggleLeft className="w-10 h-10 text-gray-300" />}
                      </button>
                  </div>

                  {/* Zero Retention Toggle */}
                  <div className="flex items-center justify-between group">
                      <div>
                          <p className="font-medium text-gray-900 flex items-center">
                              <AlertCircle className="w-4 h-4 mr-2 text-gray-500" />
                              零留存模式 (Zero Retention)
                          </p>
                          <p className="text-xs text-gray-500 mt-1 max-w-xs">
                              强制要求模型服务商不缓存任何会话数据（可能会降低上下文连贯性）。
                          </p>
                      </div>
                      <button onClick={() => setDataRetention(!dataRetention)}>
                          {dataRetention ? <ToggleRight className="w-10 h-10 text-indigo-600" /> : <ToggleLeft className="w-10 h-10 text-gray-300" />}
                      </button>
                  </div>
              </div>
          </div>

          {/* Cost Control */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 lg:col-span-2">
              <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
                  <Sliders className="w-5 h-5 mr-2 text-gray-600" />
                  成本控制阈值
              </h3>
              <div className="pt-2">
                   <div className="flex justify-between items-center mb-2">
                       <label className="text-sm font-medium text-gray-700">每日 API 消耗上限预警</label>
                       <span className="text-sm font-bold text-indigo-600">$5.00 / Day</span>
                   </div>
                   <input type="range" className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600" defaultValue={20} />
                   <div className="flex justify-between text-xs text-gray-500 mt-2">
                       <span>$0 (Free Tier)</span>
                       <span>$10</span>
                       <span>$50</span>
                       <span>$100+</span>
                   </div>
                   <p className="text-xs text-gray-400 mt-3 bg-gray-50 p-2 rounded">
                       * 当前使用 Kimi K2.5 模型，建议按供应商实时计费口径评估月度成本并设置预算告警阈值。
                   </p>
              </div>
          </div>

          <div className={`bg-white p-6 rounded-xl shadow-sm border lg:col-span-2 ${activePanel === 'members' ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-gray-100'}`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900 flex items-center">
                  <Users className="w-5 h-5 mr-2 text-blue-600" />
                  成员与岗位（方案A：本地账号）
                </h3>
                <button
                  onClick={() => setIsCreatingUser(true)}
                  className="flex items-center px-3 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-sm transition-all active:scale-95 text-xs font-bold"
                >
                  <Plus className="w-4 h-4 mr-1.5" />
                  新增成员
                </button>
              </div>

              <div className="space-y-3">
                {sortedUsers.map(u => (
                  <div key={u.id} className="p-4 rounded-2xl border border-gray-100 bg-gray-50/30">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                          <input
                            className="w-full max-w-xs bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:ring-2 focus:ring-indigo-500/20"
                            value={u.name}
                            onChange={(e) => updateUserProfile(u.id, { name: e.target.value })}
                          />
                          <span className="text-[10px] font-mono text-gray-400">{u.id}</span>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {roleOptions.map(r => (
                            <button
                              key={r.id}
                              onClick={() => toggleRole(u, r.id)}
                              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                                u.roles.includes(r.id)
                                  ? 'bg-indigo-600 text-white border-indigo-600'
                                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                              }`}
                            >
                              {r.name}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full lg:w-[520px]">
                        <div>
                          <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">岗位标签</div>
                          <input
                            className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
                            value={(u.positionTags || []).join('，')}
                            onChange={(e) => updateUserProfile(u.id, { positionTags: parseTags(e.target.value) })}
                            placeholder="例如：台账指导兼职，食品包装认证指导"
                          />
                        </div>
                        <div>
                          <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">归属负责人</div>
                          <select
                            className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
                            value={u.reportsToUserId || ''}
                            onChange={(e) => updateUserProfile(u.id, { reportsToUserId: e.target.value || undefined })}
                          >
                            <option value="">无</option>
                            {reportsToOptions.filter(x => x.id !== u.id).map(x => (
                              <option key={x.id} value={x.id}>{x.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => updateUserProfile(u.id, {})}
                          className="px-3 py-2 rounded-xl bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 text-xs font-bold flex items-center"
                          title="写入并自动校验 activeRole"
                        >
                          <Save className="w-4 h-4 mr-1.5" />
                          保存
                        </button>
                        <button
                          onClick={() => deleteUserProfile(u.id)}
                          className="px-3 py-2 rounded-xl bg-red-50 border border-red-100 text-red-600 hover:bg-red-100 text-xs font-bold flex items-center"
                          title="删除成员"
                        >
                          <Trash2 className="w-4 h-4 mr-1.5" />
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {isCreatingUser && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                  <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl p-8 animate-in fade-in zoom-in duration-300 border border-gray-100">
                    <div className="flex justify-between items-center mb-6">
                      <h2 className="text-xl font-black text-gray-900">新增成员</h2>
                      <button
                        onClick={() => { setIsCreatingUser(false); setNewUser({ id: '', name: '', roles: ['CONSULTANT'], activeRole: 'CONSULTANT', positionTags: [] }); }}
                        className="px-3 py-2 rounded-xl bg-gray-50 border border-gray-100 text-gray-600 text-xs font-bold"
                      >
                        关闭
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">成员ID</div>
                        <input
                          className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                          value={newUser.id}
                          onChange={(e) => setNewUser(prev => ({ ...prev, id: e.target.value.trim() }))}
                          placeholder="例如：U-017"
                        />
                      </div>
                      <div>
                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">姓名</div>
                        <input
                          className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                          value={newUser.name}
                          onChange={(e) => setNewUser(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="例如：张三"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">岗位标签</div>
                        <input
                          className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                          value={(newUser.positionTags || []).join('，')}
                          onChange={(e) => setNewUser(prev => ({ ...prev, positionTags: parseTags(e.target.value) }))}
                          placeholder="例如：台账指导兼职"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">角色</div>
                        <div className="flex flex-wrap gap-2">
                          {roleOptions.map(r => (
                            <button
                              key={r.id}
                              onClick={() => {
                                const roles = newUser.roles.includes(r.id)
                                  ? newUser.roles.filter(x => x !== r.id)
                                  : [...newUser.roles, r.id];
                                if (roles.length === 0) return;
                                const activeRole = roles.includes(newUser.activeRole) ? newUser.activeRole : roles[0];
                                setNewUser(prev => ({ ...prev, roles, activeRole }));
                              }}
                              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                                newUser.roles.includes(r.id)
                                  ? 'bg-indigo-600 text-white border-indigo-600'
                                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                              }`}
                            >
                              {r.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end gap-3 mt-8">
                      <button
                        onClick={() => { setIsCreatingUser(false); setNewUser({ id: '', name: '', roles: ['CONSULTANT'], activeRole: 'CONSULTANT', positionTags: [] }); }}
                        className="px-6 py-3 font-bold text-gray-400"
                      >
                        取消
                      </button>
                      <button
                        onClick={() => {
                          if (!newUser.id || !newUser.name || newUser.roles.length === 0) return;
                          addUserProfile(newUser);
                          setIsCreatingUser(false);
                          setNewUser({ id: '', name: '', roles: ['CONSULTANT'], activeRole: 'CONSULTANT', positionTags: [] });
                        }}
                        className="px-10 py-3 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 shadow-xl shadow-indigo-500/20 transition-all active:scale-95"
                      >
                        确认新增
                      </button>
                    </div>
                  </div>
                </div>
              )}
          </div>
      </div>
    </div>
  );
};

export default AICenter;
