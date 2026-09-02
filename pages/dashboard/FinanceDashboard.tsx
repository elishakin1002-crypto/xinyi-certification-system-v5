import React from 'react';
import { AlertOctagon, FileWarning, PieChart } from 'lucide-react';
import { RoleDashboardMetrics } from '../../services/dashboardMetrics';
import PersonaDashboard from './PersonaDashboard';

type Props = {
  metrics: RoleDashboardMetrics;
};

const FinanceDashboard: React.FC<Props> = ({ metrics }) => (
  <PersonaDashboard
    metrics={metrics}
    headline={{ title: '现金流', subtitle: '本月应收、已收与超期金额对照，超期已单独标红。' }}
    emphasisId="fin-overdue"
    sections={[
      {
        key: 'abnormal',
        title: '异常与风险',
        subtitle: '数据缺失、未开票和回款进度异常，都会影响账目准确性。',
        icon: <AlertOctagon className="w-5 h-5 text-amber-600" />,
        cards: metrics.middleCards,
        cols: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4'
      },
      {
        key: 'structure',
        title: '结构分析',
        subtitle: '看收入来自哪些行业和客户，判断集中度风险。',
        icon: <PieChart className="w-5 h-5 text-indigo-600" />,
        cards: metrics.bottomCards,
        cols: 'grid-cols-1 md:grid-cols-3'
      }
    ]}
    list={{
      title: '异常清单',
      subtitle: '需要逐条核对的账目，点击进入对应记录。',
      icon: <FileWarning className="w-5 h-5 text-red-600" />
    }}
  />
);

export default FinanceDashboard;
