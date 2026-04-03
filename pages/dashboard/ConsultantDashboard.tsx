import React from 'react';
import { useNavigate } from 'react-router-dom';
import { RoleDashboardMetrics } from '../../services/dashboardMetrics';
import { openDashboardRoute } from '../../src/modules/dashboardNavigation';

type Props = {
  metrics: RoleDashboardMetrics;
};

const ConsultantDashboard: React.FC<Props> = ({ metrics }) => {
  const navigate = useNavigate();

  const renderCards = (cards: RoleDashboardMetrics['topCards'], colsClass: string) => {
    if (!cards || cards.length === 0) {
      return <div className="text-sm text-gray-500">暂无数据</div>;
    }
    return (
      <div className={`grid ${colsClass} gap-4`}>
        {cards.map(card => (
          <button
            key={card.id}
            type="button"
            onClick={() => openDashboardRoute(navigate, card.route)}
            className="text-left bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow-md hover:border-indigo-200 transition"
          >
            <div className="text-sm text-gray-500">{card.title}</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{card.value || '暂无数据'}</div>
            {card.hint ? <div className="mt-1 text-xs text-gray-400">{card.hint}</div> : null}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6 animate-in fade-in duration-300">
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">咨询师交付面板</h2>
        <p className="text-sm text-gray-500 mt-1">按 owner=me 聚焦交付进展、风险和沉淀。</p>
      </div>

      <section className="space-y-3">
        <h3 className="text-base font-semibold text-gray-900">我的交付状态</h3>
        {renderCards(metrics.topCards, 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4')}
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-semibold text-gray-900">风险与提醒</h3>
        {renderCards(metrics.middleCards, 'grid-cols-1 md:grid-cols-3')}
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-semibold text-gray-900">工作沉淀</h3>
        {renderCards(metrics.bottomCards, 'grid-cols-1 md:grid-cols-3')}
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-semibold text-gray-900">今日必须处理</h3>
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm divide-y divide-gray-100">
          {metrics.listItems.length === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-500">暂无数据</div>
          ) : (
            metrics.listItems.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.route)}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 transition"
              >
                <div className="text-sm font-medium text-gray-900">{item.title}</div>
                {item.subtitle ? <div className="text-xs text-gray-500 mt-1">{item.subtitle}</div> : null}
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
};

export default ConsultantDashboard;
