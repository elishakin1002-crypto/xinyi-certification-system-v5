import React, { useSyncExternalStore } from 'react';
import { stateSyncService } from '../services/stateSyncService';

export default function StateSyncNotice() {
  const error = useSyncExternalStore(stateSyncService.subscribe, stateSyncService.getSyncError);
  if (!error) return null;
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(stateSyncService.exportPending(), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `未保存记录-${Date.now()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div role="alert" className="m-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
    <p className="font-bold">有内容尚未保存到服务器</p>
    <p>{error}</p>
    <p>请勿直接关闭页面。可先导出未保存内容交给管理员核对；网络恢复后可重试。</p>
    <div className="mt-2 flex flex-wrap gap-3">
      <button type="button" className="rounded border border-red-300 px-3 py-2" onClick={download}>导出未保存内容</button>
      <button type="button" className="rounded border border-red-300 px-3 py-2" onClick={stateSyncService.retry}>重试保存</button>
    </div>
  </div>;
}
