import React from 'react';
import { Flame, ListChecks, Target } from 'lucide-react';
import { RoleDashboardMetrics } from '../../services/dashboardMetrics';
import PersonaDashboard from './PersonaDashboard';

type Props = {
  metrics: RoleDashboardMetrics;
};

const SalesDashboard: React.FC<Props> = ({ metrics }) => (
  <PersonaDashboard
    metrics={metrics}
    headline={{ title: '我的成交指标', subtitle: '只统计归属于我的线索、跟进与签约，先看结果再看机会。' }}
    emphasisId="sales-sign-amt"
    sections={[
      {
        key: 'opportunities',
        title: '机会箱',
        subtitle: '按紧迫程度排列：该催的、该唤醒的、该复购的。',
        icon: <Target className="w-5 h-5 text-indigo-600" />,
        cards: metrics.middleCards,
        cols: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-5'
      },
      {
        key: 'today',
        /*
          原来叫「今日行动清单」，和上面的「我今天的活」撞车 ——
          后者是我的项目任务，这里是该联系的客户，两回事却都叫「今天要做」。
        */
        title: '今天该联系谁',
        subtitle: '今天必须推进的三件事，点击进入对应列表。',
        icon: <ListChecks className="w-5 h-5 text-emerald-600" />,
        cards: metrics.bottomCards,
        cols: 'grid-cols-1 md:grid-cols-3'
      }
    ]}
    list={{
      title: '优先处理列表',
      subtitle: '系统按跟进时效和成交意向排出的处理顺序。',
      icon: <Flame className="w-5 h-5 text-orange-500" />
    }}
  />
);

export default SalesDashboard;
