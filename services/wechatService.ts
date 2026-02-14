import { Reminder, WeChatBinding, UserProfile, ReminderSeverity } from '../types';
import { dataService } from './dataService';

// Simulate a database of bindings
// In a real app, this would be in the backend database
const MOCK_BINDINGS: Record<string, WeChatBinding> = dataService.get<Record<string, WeChatBinding>>('wechat_bindings_v1', {});

const persistBindings = () => {
  dataService.set('wechat_bindings_v1', MOCK_BINDINGS);
};

// Event name for UI updates
export const WECHAT_PUSH_EVENT = 'WECHAT_PUSH_NOTIFICATION';

export interface WeChatPushMessage {
  to: string;
  title: string;
  content: string;
  timestamp: string;
  originalReminderId: string;
  severity: ReminderSeverity;
}

export const wechatService = {
  // 1. Binding Capability
  bindUser: (user: UserProfile, wechatId: string): WeChatBinding => {
    const binding: WeChatBinding = {
      userId: user.id,
      wechatId,
      nickname: `WeChat_${wechatId.substring(0, 6)}`,
      boundAt: new Date().toISOString(),
      status: 'active',
      config: {
        pushEnabled: true,
        minSeverity: 'medium', // Default to medium
        dailySummary: true
      }
    };
    MOCK_BINDINGS[user.id] = binding;
    persistBindings();
    console.log(`[WeChat] User ${user.name} bound to ${wechatId}`);
    return binding;
  },

  unbindUser: (userId: string) => {
    delete MOCK_BINDINGS[userId];
    persistBindings();
  },

  getBinding: (userId: string): WeChatBinding | undefined => {
    return MOCK_BINDINGS[userId];
  },

  updateConfig: (userId: string, config: Partial<WeChatBinding['config']>) => {
    const binding = MOCK_BINDINGS[userId];
    if (binding) {
      binding.config = { ...binding.config, ...config };
      MOCK_BINDINGS[userId] = binding;
      persistBindings();
    }
  },

  // 2. AI Filter Logic (The "Brain")
  // Determines if this specific reminder is "worth disturbing" the user via WeChat
  shouldPush: (reminder: Reminder, binding: WeChatBinding): boolean => {
    if (binding.status !== 'active' || !binding.config.pushEnabled) return false;

    // Infer Severity Logic
    let severity: ReminderSeverity = 'low';
    
    // Critical types are always High
    if (reminder.type === 'risk' || reminder.type === 'expire') {
      severity = 'high';
    } 
    // Opportunity and Task are Medium
    else if (reminder.type === 'opportunity' || reminder.type === 'task') {
      severity = 'medium';
    }
    // Others Low
    else {
      severity = 'low';
    }

    const severityLevels: Record<ReminderSeverity, number> = { low: 1, medium: 2, high: 3 };
    const reminderLevel = severityLevels[severity];
    const configLevel = severityLevels[binding.config.minSeverity];

    // Only push if severity meets the user's threshold
    return reminderLevel >= configLevel;
  },

  // 3. Push Capability (The "Nerve")
  pushMessage: (userId: string, reminder: Reminder) => {
    const binding = MOCK_BINDINGS[userId];
    if (!binding) return false;

    // Infer Severity again for display
    let severity: ReminderSeverity = 'low';
    if (reminder.type === 'risk' || reminder.type === 'expire') severity = 'high';
    else if (reminder.type === 'opportunity' || reminder.type === 'task') severity = 'medium';

    const message: WeChatPushMessage = {
      to: binding.wechatId,
      title: `[信义大脑] ${reminder.title}`,
      content: reminder.content,
      timestamp: new Date().toISOString(),
      originalReminderId: reminder.id,
      severity
    };

    console.log('🚀 [WeChat Push] Sending to', binding.nickname, message);

    // Dispatch event for the Mock Phone UI
    const event = new CustomEvent(WECHAT_PUSH_EVENT, { detail: message });
    window.dispatchEvent(event);

    return true;
  }
};
