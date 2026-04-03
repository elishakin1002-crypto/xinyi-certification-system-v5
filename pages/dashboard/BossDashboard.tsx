import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Briefcase, Coins, Percent, ShieldAlert, Users } from 'lucide-react';
import { DashboardCard } from '../../services/dashboardMetrics';
import { openDashboardRoute } from '../../src/modules/dashboardNavigation';

type Props = {
  overviewCards: DashboardCard[];
  riskCards: DashboardCard[];
  teamCards: DashboardCard[];
};

const cardSubtitleById: Record<string, string> = {
  'boss-revenue-count': '统计口径：本月完成且判定为营收项目的数量',
  'boss-revenue-amount': '统计口径：本月营收项目金额（缺失时回退合同金额）',
  'boss-conv': '统计口径：线索→营收项目（005A 口径）',
  'boss-overdue-amount': '统计口径：已逾期未回款金额',
  'boss-overdue-amt': '统计口径：已逾期未回款金额'
};

const getOverviewTone = (cardId: string) => {
  if (cardId.includes('overdue')) return { value: 'text-red-600', bg: 'bg-red-50', icon: 'text-red-600' };
  if (cardId.includes('conv')) return { value: 'text-indigo-600', bg: 'bg-indigo-50', icon: 'text-indigo-600' };
  if (cardId.includes('revenue-count')) return { value: 'text-green-600', bg: 'bg-green-50', icon: 'text-green-600' };
  return { value: 'text-blue-600', bg: 'bg-blue-50', icon: 'text-blue-600' };
};

const getOverviewIcon = (cardId: string) => {
  if (cardId.includes('overdue')) return <AlertTriangle className="w-5 h-5" />;
  if (cardId.includes('conv')) return <Percent className="w-5 h-5" />;
  if (cardId.includes('revenue-count')) return <Briefcase className="w-5 h-5" />;
  return <Coins className="w-5 h-5" />;
};

const getRiskIcon = (cardId: string) => {
  if (cardId.includes('high-risk')) return <ShieldAlert className="w-5 h-5 text-red-600" />;
  if (cardId.includes('overdue')) return <AlertTriangle className="w-5 h-5 text-amber-600" />;
  return <AlertTriangle className="w-5 h-5 text-orange-600" />;
};

const getTeamIcon = () => <Users className="w-5 h-5 text-blue-600" />;

const BossDashboard: React.FC<Props> = ({ overviewCards, riskCards, teamCards }) => {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-5 shadow-sm">
        <div className="mb-4">
          <h3 className="text-lg font-black text-gray-900">📊 本月经营概览</h3>
          <p className="text-xs text-gray-500 mt-1">先看结果：收入、转化与逾期回款风险。</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {overviewCards.map(card => {
            const tone = getOverviewTone(card.id);
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => openDashboardRoute(navigate, card.route)}
                className="text-left bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow-md hover:border-indigo-200 transition"
                title={card.title}
              >
                <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg ${tone.bg} ${tone.icon}`}>
                  {getOverviewIcon(card.id)}
                </div>
                <div className={`mt-3 text-3xl font-black ${tone.value}`}>{card.value || '暂无数据'}</div>
                <div className="mt-1 text-sm font-bold text-gray-800">{card.title}</div>
                <div className="mt-1 text-xs text-gray-500 line-clamp-2">{cardSubtitleById[card.id] || card.hint || '统计口径见指标说明'}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-red-100 bg-red-50/30 p-5 shadow-sm">
        <div className="mb-4">
          <h3 className="text-lg font-black text-gray-900">⚠ 风险与异常</h3>
          <p className="text-xs text-gray-500 mt-1">默认按严重度排序，点击卡片可进入处理列表。</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {riskCards.map(card => (
            <button
              key={card.id}
              type="button"
              onClick={() => navigate(card.route)}
              className="text-left bg-white border border-red-100 rounded-xl p-4 shadow-sm hover:shadow-md hover:border-red-200 transition"
              title={card.title}
            >
              <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-red-50">{getRiskIcon(card.id)}</div>
              <div className="mt-3 text-2xl font-black text-red-600">{card.value || '暂无数据'}</div>
              <div className="mt-1 text-sm font-bold text-gray-800">{card.title}</div>
              <div className="mt-1 text-xs text-gray-500">{card.hint || '点击查看详情与处置对象'}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-blue-100 bg-blue-50/30 p-5 shadow-sm">
        <div className="mb-4">
          <h3 className="text-lg font-black text-gray-900">👥 团队产能与执行</h3>
          <p className="text-xs text-gray-500 mt-1">关注产能、延误与日志覆盖，确保团队运转稳定。</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {teamCards.map(card => (
            <button
              key={card.id}
              type="button"
              onClick={() => navigate(card.route)}
              className="text-left bg-white border border-blue-100 rounded-xl p-4 shadow-sm hover:shadow-md hover:border-blue-200 transition"
              title={card.title}
            >
              <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-blue-50">{getTeamIcon()}</div>
              <div className="mt-3 text-2xl font-black text-blue-700">{card.value || '暂无数据'}</div>
              <div className="mt-1 text-sm font-bold text-gray-800">{card.title}</div>
              <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
                <span>趋势占位</span>
                <span className="font-black">↑</span>
                <span className="font-black">↓</span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
};

export default BossDashboard;
