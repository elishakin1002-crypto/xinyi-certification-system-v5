import React from 'react';
import { AlertOctagon, BookOpen, ClipboardList } from 'lucide-react';
import { RoleDashboardMetrics } from '../../services/dashboardMetrics';
import PersonaDashboard from './PersonaDashboard';

type Props = {
  metrics: RoleDashboardMetrics;
};

const ConsultantDashboard: React.FC<Props> = ({ metrics }) => (
  <PersonaDashboard
    metrics={metrics}
    headline={{ title: '我的交付状态', subtitle: '只统计我负责的项目与任务，逾期项已单独标红。' }}
    emphasisId="cons-overdue-task"
    sections={[
      {
        key: 'risk',
        title: '风险与提醒',
        subtitle: '快到期、堆积和进度落后的项目，优先处理这几类。',
        icon: <AlertOctagon className="w-5 h-5 text-amber-600" />,
        cards: metrics.middleCards,
        cols: 'grid-cols-1 md:grid-cols-3'
      },
      {
        key: 'output',
        title: '工作沉淀',
        subtitle: '本周日志、工时与参与项目，用于周会汇报和工时核算。',
        icon: <BookOpen className="w-5 h-5 text-blue-600" />,
        cards: metrics.bottomCards,
        cols: 'grid-cols-1 md:grid-cols-3'
      }
    ]}
    list={{
      title: '今日必须处理',
      subtitle: '按截止时间排序，逾期和当天到期的排在最前。',
      icon: <ClipboardList className="w-5 h-5 text-indigo-600" />
    }}
  />
);

export default ConsultantDashboard;
