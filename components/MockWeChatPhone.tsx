import React, { useEffect, useState } from 'react';
import { WeChatPushMessage, WECHAT_PUSH_EVENT } from '../services/wechatService';
import { X, MessageSquare, Bell } from 'lucide-react';

export const MockWeChatPhone: React.FC = () => {
  const [messages, setMessages] = useState<WeChatPushMessage[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);

  useEffect(() => {
    const handlePush = (event: Event) => {
      const customEvent = event as CustomEvent<WeChatPushMessage>;
      setMessages(prev => [customEvent.detail, ...prev]);
      setHasUnread(true);
      
      // Auto-open on High Severity if closed
      if (customEvent.detail.severity === 'high' && !isOpen) {
        setIsOpen(true);
      }
    };

    window.addEventListener(WECHAT_PUSH_EVENT, handlePush);
    return () => window.removeEventListener(WECHAT_PUSH_EVENT, handlePush);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setHasUnread(false);
    }
  }, [isOpen]);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-24 z-50 p-4 bg-green-600 hover:bg-green-700 text-white rounded-full shadow-xl transition-all hover:scale-105 flex items-center gap-2"
        title="WeChat Notifications (Mock)"
      >
        <MessageSquare size={24} />
        {hasUnread && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full animate-pulse" />
        )}
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-24 z-50 w-[320px] h-[600px] bg-gray-100 rounded-[30px] shadow-2xl border-8 border-gray-800 flex flex-col overflow-hidden font-sans">
      {/* Phone Notch/Status Bar */}
      <div className="bg-gray-800 text-white px-6 py-2 text-xs flex justify-between items-center rounded-t-[20px]">
        <span>9:41</span>
        <div className="flex gap-1">
          <div className="w-3 h-3 bg-white rounded-full opacity-20"></div>
          <div className="w-3 h-3 bg-white rounded-full opacity-20"></div>
        </div>
      </div>

      {/* Header */}
      <div className="bg-[#ededed] px-4 py-3 flex justify-between items-center border-b border-gray-300">
        <div className="flex items-center gap-2">
          <span className="text-black font-medium">信义全能大脑</span>
        </div>
        <button onClick={() => setIsOpen(false)} className="text-gray-600 hover:text-black">
          <X size={20} />
        </button>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#f5f5f5]">
        <div className="text-center text-xs text-gray-400 my-2">Today</div>
        
        {messages.length === 0 ? (
          <div className="text-center text-gray-400 text-sm mt-20">
            <p>No messages yet</p>
            <p className="text-xs mt-2">Trigger system events to see pushes</p>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div key={idx} className="flex flex-col gap-1 items-start">
              {/* Avatar */}
              <div className="flex gap-2 max-w-[90%]">
                <div className="w-8 h-8 rounded bg-blue-600 flex-shrink-0 flex items-center justify-center text-white text-xs font-bold">
                  Brain
                </div>
                <div className="bg-white p-3 rounded-lg rounded-tl-none shadow-sm text-sm text-gray-800 border border-gray-200">
                  <div className="font-bold mb-1 text-black flex items-center gap-2">
                    {msg.title}
                    {msg.severity === 'high' && <Bell size={12} className="text-red-500" />}
                  </div>
                  <p className="leading-relaxed">{msg.content}</p>
                  <div className="mt-2 pt-2 border-t border-gray-100 flex justify-between items-center text-xs text-gray-400">
                    <span>系统通知</span>
                    <span>详情 &gt;</span>
                  </div>
                </div>
              </div>
              <span className="text-[10px] text-gray-400 ml-10">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Footer input (disabled) */}
      <div className="bg-[#f7f7f7] p-3 border-t border-gray-300 flex items-center gap-2">
        <div className="w-8 h-8 rounded-full border border-gray-400 flex items-center justify-center">
           <span className="text-gray-400">...</span>
        </div>
        <div className="flex-1 h-9 bg-white rounded border border-gray-300 flex items-center px-3 text-gray-400 text-sm">
          Type a message...
        </div>
        <div className="w-8 h-8 rounded-full border border-gray-400 flex items-center justify-center">
           <span className="text-gray-400">+</span>
        </div>
      </div>
    </div>
  );
};
