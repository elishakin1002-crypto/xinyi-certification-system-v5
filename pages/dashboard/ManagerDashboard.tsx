import React from 'react';
import { ClipboardList, ListChecks, Users } from 'lucide-react';
import { RoleDashboardMetrics } from '../../services/dashboardMetrics';
import PersonaDashboard from './PersonaDashboard';

/**
 * 总助工作台。
 *
 * ── 为什么单独一套指标，却复用同一套外观 ──────────────────────
 *
 * **内容要不一样，样子不该不一样。**
 *
 * 内容不一样：借总经理那套的话，第一眼给的是本月签约金额、已回款、
 * 回款风险 —— 这些她既不负责也无权处理（没有确认到账和结算权限）。
 * 看得见但动不了的数字占着最显眼的位置，把她真正该盯的挤到下面去了。
 * 她的活是「代总经理统筹派活与进度」，所以只回答三个问题：
 * 谁手上活太多 · 哪个项目要延期 · 这周谁没记日志。
 *
 * 样子不该不一样：2026-09-05 反馈「总助和系统管理员的工作台风格
 * 和其他角色不统一」。第一版我给她手写了一套卡片，
 * 结果同一个系统里出现了两种视觉语言 —— 换个角色登录像换了个软件。
 * 现在改成和销售/顾问/财务同一个 PersonaDashboard，
 * **差异只体现在数据上**。
 *
 * ── 为什么中间那块列人名，不是「人均在制项目数」 ──────────────
 * 「人均 3.67 个」对派活毫无用处：可能是 5 个人各 3-4 个（正常），
 * 也可能是 1 个人扛 11 个、另外 4 个人各 0 个（要立刻调）。
 * 平均值恰好把这两种情况混成同一个数，而这两种情况要做的事完全相反。
 */

type Props = {
  metrics: RoleDashboardMetrics;
};

const ManagerDashboard: React.FC<Props> = ({ metrics }) => (
  <PersonaDashboard
    metrics={metrics}
    headline={{
      title: '我要盯的进度',
      subtitle: '谁手上活太多、哪个项目要延期、这周谁没记日志。金额的事在合同和回款页看。'
    }}
    /* 强调「已逾期任务」：其余三项是提前量，只有这一项是已经发生的事 */
    emphasisId="mgr-overdue-task"
    sections={[
      {
        key: 'load',
        title: '谁手上活多少',
        subtitle: '按进行中项目数排。派活之前先看这里，别只盯着好说话的那几个人。',
        icon: <Users className="w-5 h-5 text-blue-600" />,
        cards: metrics.middleCards,
        cols: 'grid-cols-2 md:grid-cols-4 xl:grid-cols-4',
        anchor: 'team-capacity'
      },
      {
        key: 'totals',
        title: '整体盘子',
        subtitle: '进行中项目、有活在手的人数、未完成任务。',
        icon: <ClipboardList className="w-5 h-5 text-emerald-600" />,
        cards: metrics.bottomCards,
        cols: 'grid-cols-1 md:grid-cols-3'
      }
    ]}
    list={{
      title: '卡住的事',
      subtitle: '项目延期最常见的原因不是做不完，是没人发现它卡住了。',
      icon: <ListChecks className="w-5 h-5 text-orange-500" />
    }}
  />
);

export default ManagerDashboard;
