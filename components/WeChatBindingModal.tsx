import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { wechatService } from '../services/wechatService';
import { WeChatBinding, ReminderSeverity } from '../types';
import { QrCode, Smartphone, Bell, BellOff, X, Check } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const WeChatBindingModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { currentUser } = useApp();
  const [binding, setBinding] = useState<WeChatBinding | undefined>(undefined);
  const [isScanning, setIsScanning] = useState(false);

  useEffect(() => {
    if (currentUser) {
      setBinding(wechatService.getBinding(currentUser.id));
    }
  }, [currentUser, isOpen]);

  const handleBind = () => {
    setIsScanning(true);
    // Simulate scan delay
    setTimeout(() => {
      const newBinding = wechatService.bindUser(currentUser, `wx_mock_${Date.now()}`);
      setBinding(newBinding);
      setIsScanning(false);
    }, 1500);
  };

  const handleUnbind = () => {
    if (confirm('确定要解绑微信吗？解绑后将无法接收重要通知。')) {
      wechatService.unbindUser(currentUser.id);
      setBinding(undefined);
    }
  };

  const updateConfig = (key: keyof WeChatBinding['config'], value: any) => {
    wechatService.updateConfig(currentUser.id, { [key]: value });
    setBinding(prev => prev ? { ...prev, config: { ...prev.config, [key]: value } } : undefined);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="bg-gray-900 text-white px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Smartphone size={20} className="text-green-400" />
            <span className="font-bold text-lg">微信通知绑定</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          <div className="flex flex-col items-center mb-6">
             <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-3 border-2 border-gray-200">
                {binding ? (
                   <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix" alt="avatar" className="w-14 h-14 rounded-full" />
                ) : (
                   <QrCode size={32} className="text-gray-400" />
                )}
             </div>
             <h3 className="font-bold text-gray-800 text-lg">{currentUser.name}</h3>
             <p className="text-xs text-gray-500">{binding ? '已绑定微信账号' : '尚未绑定微信通知'}</p>
          </div>

          {!binding ? (
            <div className="space-y-4">
              <div className="bg-blue-50 text-blue-800 text-sm p-4 rounded-lg flex gap-3 items-start">
                 <Bell size={16} className="mt-1 flex-shrink-0" />
                 <div>
                    <p className="font-bold mb-1">为什么要绑定？</p>
                    <p className="opacity-80 text-xs">绑定后，重要提醒（如任务逾期、证书到期）将直接推送到您的微信，避免遗漏。</p>
                 </div>
              </div>
              <button 
                onClick={handleBind}
                disabled={isScanning}
                className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all"
              >
                {isScanning ? (
                  <>正在扫描...</>
                ) : (
                  <>
                    <QrCode size={18} />
                    生成绑定二维码
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
               <div className="bg-green-50 border border-green-100 rounded-xl p-4">
                  <div className="flex justify-between items-center mb-3">
                     <span className="text-sm text-gray-600">微信昵称</span>
                     <span className="font-bold text-green-700">{binding.nickname}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs text-gray-400">
                     <span>绑定时间</span>
                     <span>{new Date(binding.boundAt).toLocaleDateString()}</span>
                  </div>
               </div>

               <div className="space-y-2">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">推送设置</p>
                  
                  <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                     <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${binding.config.pushEnabled ? 'bg-green-100 text-green-600' : 'bg-gray-200 text-gray-500'}`}>
                           {binding.config.pushEnabled ? <Bell size={16} /> : <BellOff size={16} />}
                        </div>
                        <span className="text-sm font-medium">开启推送</span>
                     </div>
                     <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" checked={binding.config.pushEnabled} onChange={(e) => updateConfig('pushEnabled', e.target.checked)} />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                     </label>
                  </div>

                  {binding.config.pushEnabled && (
                     <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                        <span className="text-sm font-medium ml-11">最低通知级别</span>
                        <select 
                           value={binding.config.minSeverity}
                           onChange={(e) => updateConfig('minSeverity', e.target.value as ReminderSeverity)}
                           className="bg-white border border-gray-300 text-gray-700 text-xs rounded-lg p-1.5 focus:ring-green-500 focus:border-green-500"
                        >
                           <option value="low">所有消息 (Low+)</option>
                           <option value="medium">重要消息 (Medium+)</option>
                           <option value="high">仅紧急 (High)</option>
                        </select>
                     </div>
                  )}
               </div>

               <button 
                  onClick={handleUnbind}
                  className="w-full text-red-500 text-xs hover:bg-red-50 py-3 rounded-lg transition-colors"
               >
                  解除绑定
               </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
