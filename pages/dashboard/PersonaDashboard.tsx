import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowRight, Briefcase, Coins, Percent, Users } from 'lucide-react';
import { DashboardCard, RoleDashboardMetrics } from '../../services/dashboardMetrics';
import { openDashboardRoute } from '../../src/modules/dashboardNavigation';
import { EmptyState } from '../../src/ui';
import { MyWorkWidget } from '../../components/MyWorkWidget';

export type PersonaSection = {
  key: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  cards: DashboardCard[];
  cols: string;
  /** 新手引导要指到这一块时填。留空就是不指 */
  anchor?: string;
};

type Props = {
  metrics: RoleDashboardMetrics;
  /** 顶部 KPI 区标题与说明 */
  headline: { title: string; subtitle: string };
  /** 顶部 KPI 中用渐变卡强调的指标 id */
  emphasisId: string;
  /** 中部与下部区块 */
  sections: PersonaSection[];
  /*
    「优先处理列表」。传 false 表示这个角色不需要它 ——
    2026-09-14 顾问那边就是：它的内容（我逾期的任务）是
    上面「我今天的活」的**严格子集**，而「我今天的活」还能直接改状态。
    同一份数据渲染两遍，人要在两个地方找"我今天干什么"。
  */
  list: { title: string; subtitle: string; icon: React.ReactNode } | false;
};

const isAlertCard = (cardId: string) => /overdue|stale|sleeping|abnormal|expiring|due-soon/.test(cardId);

const cardIcon = (cardId: string) => {
  if (isAlertCard(cardId)) return <AlertTriangle className="w-6 h-6" />;
  if (/conversion|ratio|concentration|big-customer/.test(cardId)) return <Percent className="w-6 h-6" />;
  if (/amt|amount|paid|rec$|rec-|sign/.test(cardId)) return <Coins className="w-6 h-6" />;
  if (/project|task/.test(cardId)) return <Briefcase className="w-6 h-6" />;
  if (/lead|customer|contact/.test(cardId)) return <Users className="w-6 h-6" />;
  return <Activity className="w-6 h-6" />;
};

const kpiTone = (cardId: string) => {
  if (isAlertCard(cardId)) return { icon: 'bg-amber-50 text-amber-600', hover: 'hover:border-amber-200' };
  if (/conversion|ratio|concentration/.test(cardId)) return { icon: 'bg-indigo-50 text-indigo-600', hover: 'hover:border-indigo-200' };
  if (/amt|amount|paid|sign/.test(cardId)) return { icon: 'bg-blue-50 text-blue-600', hover: 'hover:border-blue-200' };
  return { icon: 'bg-emerald-50 text-emerald-600', hover: 'hover:border-emerald-200' };
};

const itemTone = (cardId: string) =>
  isAlertCard(cardId) ? 'border-amber-100 bg-amber-50/70' : 'border-gray-100 bg-gray-50';

const PersonaDashboard: React.FC<Props> = ({ metrics, headline, emphasisId, sections, list }) => {
  const navigate = useNavigate();
  const topCards = metrics.topCards || [];

  return (
    <div className="space-y-6">
      {/* 顶部 KPI */}
      <div>
        <div className="mb-4">
          <h2 className="text-lg font-black text-gray-900">{headline.title}</h2>
          <p className="text-xs text-gray-500 mt-1">{headline.subtitle}</p>
        </div>
        {topCards.length === 0 ? (
          /* 「暂无数据」只说了没有，没说为什么和该干嘛（2026-09-08 换掉）*/
          <EmptyState
            compact
            title="这一块还没有数字"
            hint="等有了线索、合同或项目，这里会自动算出来 —— 它不需要你手动填。"
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {topCards.map(card => {
              if (card.id === emphasisId) {
                const alert = isAlertCard(card.id);
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => openDashboardRoute(navigate, card.route)}
                    title={card.hint || card.title}
                    className={`min-w-0 w-full text-left p-5 rounded-2xl shadow-lg flex items-center text-white transition-transform active:scale-[0.98] bg-gradient-to-br ${
                      alert ? 'from-rose-500 to-red-600' : 'from-indigo-600 to-blue-700'
                    }`}
                  >
                    <div className="p-3 bg-white/20 rounded-xl mr-4">{cardIcon(card.id)}</div>
                    <div className="min-w-0">
                      <div className="text-2xl font-black truncate">{card.value || '暂无数据'}</div>
                      <div className="text-xs opacity-80 font-bold uppercase tracking-tight">{card.title}</div>
                    </div>
                  </button>
                );
              }
              const tone = kpiTone(card.id);
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => openDashboardRoute(navigate, card.route)}
                  title={card.hint || card.title}
                  className={`min-w-0 w-full text-left bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center group transition-colors ${tone.hover}`}
                >
                  <div className={`p-3 rounded-xl mr-4 group-hover:scale-110 transition-transform ${tone.icon}`}>
                    {cardIcon(card.id)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-2xl font-black text-gray-900 truncate">{card.value || '暂无数据'}</div>
                    <div className="text-xs text-gray-400 font-bold uppercase tracking-tight">{card.title}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/*
        「我今天的活」摘要 —— 紧跟在 KPI 后面。

        金恩来 2026-09-08：「是不是把任务管理直接融入到工作台就好了？」
        答案是主从不是二选一：工作台放三五条摘要（它是「看」的地方），
        我的任务放全量和操作（它是「做」的地方）。

        在这一块出现之前，两页是**断的**：工作台看完知道有事，
        却还要自己走去侧边栏点「我的任务」。少的就是这一步。

        放在所有角色的工作台上 —— 每个人都有活，包括总助和财务。
      */}
      <MyWorkWidget />

      {/* 中部 / 下部区块 */}
      {sections.map(section => (
        <div key={section.key} data-onboard={section.anchor} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-black text-gray-900 flex items-center">
                <span className="mr-2">{section.icon}</span>
                {section.title}
              </h2>
              <p className="text-xs text-gray-500 mt-1">{section.subtitle}</p>
            </div>
            <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-gray-50 text-gray-600 border border-gray-200 self-start">
              共 {section.cards.length} 项
            </span>
          </div>
          {section.cards.length === 0 ? (
            <EmptyState compact title="这一块还没有内容" hint="数据够了它会自己出现。" />
          ) : (
            <div className={`grid ${section.cols} gap-3`}>
              {section.cards.map(card => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => openDashboardRoute(navigate, card.route)}
                  title={card.hint || card.title}
                  className={`text-left rounded-2xl border p-4 transition-all hover:shadow-sm active:scale-[0.99] ${itemTone(card.id)}`}
                >
                  <div className="text-[11px] font-black uppercase tracking-wide text-gray-500 line-clamp-1">{card.title}</div>
                  <div className="mt-2 text-xl font-black text-gray-900 line-clamp-1">{card.value || '暂无数据'}</div>
                  {card.hint && <div className="mt-2 text-xs leading-5 text-gray-600 line-clamp-2">{card.hint}</div>}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* 优先处理列表（角色可以不要它，见上面 list 的说明） */}
      {list && (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-black text-gray-900 flex items-center">
              <span className="mr-2">{list.icon}</span>
              {list.title}
            </h2>
            <p className="text-xs text-gray-500 mt-1">{list.subtitle}</p>
          </div>
          <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-gray-50 text-gray-600 border border-gray-200 self-start">
            {metrics.listItems.length} 条
          </span>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-3">
          <div className="max-h-[320px] overflow-y-auto custom-scrollbar space-y-2">
            {metrics.listItems.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">暂无待处理事项</div>
            ) : (
              metrics.listItems.map(item => (
                <button
                  key={item.id}
                  type="button"
                  /*
                    同 BossDashboard 的团队卡片：待办列表项的路由带 leadId / projectId
                    等参数，要经 openDashboardRoute 翻译成 state 才会打开对应记录。
                    直接 navigate 只会跳到列表页，点哪条都一样。
                  */
                  onClick={() => openDashboardRoute(navigate, item.route)}
                  className="w-full flex items-center justify-between gap-3 text-left p-3 rounded-xl border border-gray-100 bg-white transition hover:border-indigo-200 hover:bg-indigo-50/40"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-gray-900 line-clamp-1">{item.title}</div>
                    {item.subtitle && <div className="text-[11px] text-gray-500 mt-1 line-clamp-1">{item.subtitle}</div>}
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-400 shrink-0" />
                </button>
              ))
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
};

export default PersonaDashboard;
