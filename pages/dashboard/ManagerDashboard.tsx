import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CalendarClock, ClipboardList, FileText, UserPlus } from 'lucide-react';
import { DashboardCard, DashboardListItem } from '../../services/dashboardMetrics';
import { openDashboardRoute } from '../../src/modules/dashboardNavigation';

/**
 * 总助工作台。
 *
 * ── 为什么单独做一套，而不是继续借用总经理那套 ────────────────
 *
 * 借来的看板第一眼给的是本月签约金额、已回款金额、回款风险 ——
 * 这些总助既不负责也无权处理（她没有确认到账和结算的权限）。
 * **看得见但动不了的数字，比看不见更糟**：它占着最显眼的位置，
 * 把她真正该盯的挤到下面去了。
 *
 * 她的活是「代总经理统筹派活与进度」，所以这套看板只回答三个问题：
 *
 *   谁手上活太多 · 哪个项目要延期 · 这周谁没记日志
 *
 * ── 为什么中间那块是每个人的名字，不是「人均在制项目数」 ──────
 *
 * 「人均 3.67 个」对派活毫无用处：可能是 5 个人各 3-4 个（正常），
 * 也可能是 1 个人扛 11 个、另外 4 个人各 0 个（要立刻调）。
 * 平均值恰好把这两种情况混成同一个数 —— 而这两种情况她要做的事
 * 完全相反。所以直接列人和数，最多的那个标出来。
 */

type Props = {
  topCards: DashboardCard[];
  loadCards: DashboardCard[];
  totalCards: DashboardCard[];
  stuckItems: DashboardListItem[];
};

const TOP_ICON: Record<string, React.ReactNode> = {
  'mgr-unassigned': <UserPlus className="w-5 h-5" />,
  'mgr-overdue-task': <AlertTriangle className="w-5 h-5" />,
  'mgr-due-soon': <CalendarClock className="w-5 h-5" />,
  'mgr-log-coverage': <FileText className="w-5 h-5" />,
};

/*
  只有「已超期任务」用警示色，而且**为 0 时不用**。
  四张卡全是红的等于没有重点；一直红着，人第三天就不看了。
*/
const isAlert = (card: DashboardCard) =>
  card.id === 'mgr-overdue-task' && Number(card.value) > 0;

const ManagerDashboard: React.FC<Props> = ({ topCards, loadCards, totalCards, stuckItems }) => {
  const navigate = useNavigate();
  const open = (route: string) => openDashboardRoute(navigate, route);

  const maxLoad = loadCards.reduce((m, c) => Math.max(m, Number(c.value) || 0), 0);

  return (
    <div className="space-y-6">

      {/* A. 今天要推的四件事 */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {topCards.map(card => {
          const alert = isAlert(card);
          return (
            <button
              key={card.id}
              onClick={() => open(card.route)}
              className={`text-left rounded-2xl border p-5 transition-colors ${
                alert
                  ? 'bg-red-50 border-red-200 hover:border-red-300'
                  : 'bg-white border-gray-100 hover:border-blue-200'
              }`}
            >
              <div className="flex items-center gap-2 mb-3">
                <span className={alert ? 'text-red-500' : 'text-gray-400'}>
                  {TOP_ICON[card.id] || <ClipboardList className="w-5 h-5" />}
                </span>
                <span className="text-xs font-black text-gray-600">{card.title}</span>
              </div>
              <div className={`text-3xl font-black tabular-nums ${alert ? 'text-red-600' : 'text-gray-900'}`}>
                {card.value}
              </div>
              {card.hint && (
                <p className="mt-1.5 text-[11px] font-bold leading-relaxed text-gray-400">{card.hint}</p>
              )}
            </button>
          );
        })}
      </div>

      {/* B. 谁手上活多少 —— 派活的依据 */}
      <div data-onboard="team-capacity" className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="mb-4">
          <h2 className="text-base font-black text-gray-900 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-blue-600" /> 谁手上活多少
          </h2>
          <p className="text-xs font-bold text-gray-400 mt-1">
            按在制项目数排。派活之前先看这里，别只盯着好说话的那几个人。
          </p>
        </div>

        {loadCards.length === 0 ? (
          <p className="text-sm font-bold text-gray-400 py-6 text-center">
            现在没有在制项目，或者项目都还没指派负责人。
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {loadCards.map(card => {
              const n = Number(card.value) || 0;
              const pct = maxLoad > 0 ? Math.round((n / maxLoad) * 100) : 0;
              const top = Boolean(card.hint);
              return (
                <li key={card.id}>
                  <button
                    onClick={() => open(card.route)}
                    className="w-full text-left group"
                  >
                    <div className="flex items-baseline justify-between gap-3 mb-1">
                      <span className="text-sm font-bold text-gray-800 group-hover:text-blue-600">
                        {card.title}
                        {top && (
                          <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-black bg-amber-50 text-amber-700">
                            手上最多
                          </span>
                        )}
                      </span>
                      <span className="text-sm font-black text-gray-900 tabular-nums shrink-0">{n}</span>
                    </div>
                    {/* 条形而不是饼图：要比的是「谁比谁多」，长度最容易比 */}
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${top ? 'bg-amber-400' : 'bg-blue-500'}`}
                        style={{ width: `${Math.max(pct, 6)}%` }}
                      />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-5 pt-4 border-t border-gray-100 grid grid-cols-3 gap-3">
          {totalCards.map(card => (
            <button key={card.id} onClick={() => open(card.route)} className="text-left group">
              <div className="text-[11px] font-black text-gray-400 group-hover:text-blue-600">{card.title}</div>
              <div className="text-lg font-black text-gray-900 tabular-nums">{card.value}</div>
            </button>
          ))}
        </div>
      </div>

      {/* C. 卡住的事 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-base font-black text-gray-900 mb-1">卡住的事</h2>
        <p className="text-xs font-bold text-gray-400 mb-4">
          项目延期最常见的原因不是做不完，是没人发现它卡住了。
        </p>
        {stuckItems.length === 0 ? (
          <p className="text-sm font-bold text-gray-400 py-6 text-center">
            没有超期任务，也没有缺负责人的项目。
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-gray-100">
            {stuckItems.map(item => (
              <li key={item.id}>
                <button
                  onClick={() => open(item.route)}
                  className="w-full flex items-center justify-between gap-3 py-3 text-left group"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-gray-800 truncate group-hover:text-blue-600">
                      {item.title}
                    </div>
                    {item.subtitle && (
                      <div className="text-xs font-bold text-gray-400 truncate">{item.subtitle}</div>
                    )}
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-300 shrink-0 group-hover:text-blue-600" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

    </div>
  );
};

export default ManagerDashboard;
