import React from 'react';
import { createRoot } from 'react-dom/client';
import StateSyncNotice from '../components/StateSyncNotice';
import { stateSyncService } from '../services/stateSyncService';
window.fetch = async () => new Response(JSON.stringify({code:5001,message:'记录已被其他同事修改，本次未保存。请先导出未保存内容，再重新加载核对。'}),{status:409});
createRoot(document.getElementById('root')!).render(<StateSyncNotice/>);
stateSyncService.rememberBaseline('project_work_logs_v1',[]);
stateSyncService.scheduleSync({datasets:{project_work_logs_v1:[{id:'preview',workContent:'仅用于界面验证'}]}});
