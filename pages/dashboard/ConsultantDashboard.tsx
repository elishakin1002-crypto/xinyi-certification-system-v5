import React from 'react';
import { AlertOctagon, BookOpen } from 'lucide-react';
import { RoleDashboardMetrics } from '../../services/dashboardMetrics';
import PersonaDashboard from './PersonaDashboard';

type Props = {
  metrics: RoleDashboardMetrics;
};

/**
 * 顾问工作台。
 *
 * ── 2026-09-14 的整合（金恩来指出三块在做重叠的事）─────────────
 *
 * 他说：「一个顾问早上打开，要在三个地方找"我今天干什么"。」
 * 查下来是真的，而且比"看起来重叠"更实在：
 *
 *   我今天的活（MyWorkWidget）   projects[].tasks 里属于我的未完成任务，
 *                               按紧急度排序，**而且能直接改状态**
 *   今日必须处理（list）         dashboardMetrics 里的 myOverdueTasks.slice(0, 8)
 *                               —— **就是上面那批的严格子集**，还只能点进去
 *
 * 同一份数据渲染两遍，后一遍功能还更弱。所以顾问这边直接把 list 关掉，
 * 「我今天的活」留着 —— 它是唯一一处能**当场把任务状态改掉**的地方，
 * 而顾问早上真正要做的动作就是这个。
 *
 * ── 顺序为什么这么排 ──────────────────────────────────────────
 *
 * 顾问的工作台要回答的是「我现在该做哪件事」，不是「我这个月干得怎么样」。
 * 所以：先动作（我今天的活）→ 再风险（哪个项目要出事）→ 最后才是数字。
 * 「工作沉淀」（本周日志/工时）挪到最后：那是周会汇报用的，
 * 一周看一次就够，不该占早上打开时的第一屏。
 *
 * 顶部 KPI 卡由 PersonaDashboard 渲染在最上面，暂时保留 ——
 * 「我逾期任务数」这类数字点进去就是筛好的列表，本身是入口不是报表。
 */
const ConsultantDashboard: React.FC<Props> = ({ metrics }) => (
  <PersonaDashboard
    metrics={metrics}
    headline={{ title: '我的交付状态', subtitle: '只统计我负责的项目与任务，逾期项已单独标红。' }}
    emphasisId="cons-overdue-task"
    sections={[
      {
        key: 'risk',
        /*
          原来叫「风险与提醒」，和下面那块「风险与异常」几乎同名（2026-09-14 金恩来指出）。
          名字要说清里面是什么：这三张卡讲的是**交付会不会延期**，不是泛泛的「风险」。
        */
        title: '交付风险',
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
    /*
      不要「今日必须处理」——它是「我今天的活」的子集，见文件头的说明。
      关掉之后不会留尾巴：metrics.listItems 仍然算着（别的角色在用），
      只是顾问这一屏不再渲染它。
    */
    list={false}
  />
);

export default ConsultantDashboard;
