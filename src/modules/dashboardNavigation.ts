import { NavigateFunction } from 'react-router-dom';

export type DashboardFocus = {
  type: string;
  owner?: 'me';
  month?: string;
  days?: number;
  status?: string;
  view?: string;
  metric?: string;
  range?: string;
  projectId?: string;
  leadId?: string;
  contractId?: string;
  settlementStatus?: string;
  analysis?: string;
  category?: string;
  tab?: string;
  panel?: string;
};

type DashboardTarget = {
  pathname: string;
  search?: string;
  state?: Record<string, unknown>;
};

const normalizeMonth = (value: string | null) => {
  if (!value) return '';
  if (value === 'this') return new Date().toISOString().slice(0, 7);
  return /^\d{4}-\d{2}$/.test(value) ? value : '';
};

const appendState = (target: DashboardTarget, key: string, value: unknown) => {
  target.state = { ...(target.state || {}), [key]: value };
};

export const buildDashboardRouteTarget = (route: string): DashboardTarget => {
  const url = new URL(route, 'http://dashboard.local');
  const pathname = url.pathname;
  const params = url.searchParams;
  const target: DashboardTarget = { pathname, search: url.search || '' };
  const owner = params.get('owner') === 'me' ? 'me' : undefined;
  const month = normalizeMonth(params.get('month'));

  if (pathname === '/leads') {
    const leadId = String(params.get('leadId') || '').trim();
    if (leadId) appendState(target, 'openDetailId', leadId);

    let focus: DashboardFocus | null = null;
    if (params.get('filter') === 'conversion') focus = { type: 'conversion', owner };
    else if (month) focus = { type: 'created_month', owner, month };
    else if (params.get('period') === 'week') focus = { type: 'created_week', owner };
    else if (params.get('todo') === 'today' || params.get('today') === 'contact') focus = { type: 'todo_today', owner };
    else if (params.get('intent') === 'high') focus = { type: 'intent_high', owner };
    else if (params.get('stale') === '7d') focus = { type: 'stale', owner, days: 7 };
    else if (params.get('status') === 'pending') focus = { type: 'status', owner, status: 'pending' };

    if (focus) appendState(target, 'dashboardFocus', leadId ? { ...focus, leadId } : focus);
    return target;
  }

  if (pathname === '/projects') {
    const projectId = String(params.get('projectId') || '').trim();
    if (projectId) appendState(target, 'openDetailId', projectId);

    let focus: DashboardFocus | null = null;
    if (params.get('mode') === 'delivery' && params.get('status') === 'completed') {
      focus = { type: 'revenue_completed', owner, month, view: String(params.get('field') || '') || undefined, projectId };
    } else if (params.get('risk') === 'high') {
      focus = { type: 'high_risk', owner, projectId };
    } else if (params.get('task') === 'overdue') {
      focus = { type: 'overdue_tasks', owner, projectId };
    } else if (params.get('task') === 'due_7d') {
      focus = { type: 'due_7d', owner, projectId };
    } else if (params.get('task') === 'completed' && params.get('range') === '7d') {
      focus = { type: 'completed_7d', owner, range: '7d', projectId };
    } else if (params.get('task') === 'customer_confirm') {
      focus = { type: 'customer_confirm', owner, projectId };
    } else if (params.get('progress') === 'lt50') {
      focus = { type: 'progress_lt_50', owner, projectId };
    } else if (params.get('filter') === 'missing_contract_amount') {
      focus = { type: 'missing_contract_amount', owner, projectId };
    } else if (params.get('filter') === 'delay') {
      focus = { type: 'delay', owner, projectId };
    } else if (params.get('tab') === 'logs') {
      focus = { type: 'logs', owner, metric: String(params.get('metric') || '') || undefined, range: String(params.get('range') || '') || undefined, projectId };
    } else if (params.get('focus') === 'stacked') {
      focus = { type: 'busiest_owner', owner, projectId };
    } else if (params.get('view') === 'team') {
      focus = { type: 'team_overview', owner, projectId };
    } else if (params.get('status') === 'active') {
      focus = { type: 'active_projects', owner, projectId };
    }

    if (focus) appendState(target, 'dashboardFocus', focus);
    return target;
  }

  if (pathname === '/contracts') {
    const contractId = String(params.get('contractId') || '').trim();
    if (contractId) appendState(target, 'openDetailId', contractId);

    let focus: DashboardFocus | null = null;
    const due = String(params.get('due') || '').trim();
    if (month) focus = { type: 'signed_month', owner, month, contractId };
    else if (due === '7d' || due === '15d') focus = { type: 'due_days', owner, days: Number(due.replace('d', '')), contractId };
    else if (params.get('status') === 'pending') focus = { type: 'pending_sign', owner, contractId };

    if (focus) appendState(target, 'dashboardFocus', focus);
    return target;
  }

  if (pathname === '/customers') {
    let focus: DashboardFocus | null = null;
    const filter = String(params.get('filter') || '').trim();
    if (filter === 'churn') focus = { type: 'churn' };
    else if (filter === 'sleeping30') focus = { type: 'sleeping30', owner };
    else if (filter === 'repurchase') focus = { type: 'repurchase', owner };
    else if (params.get('tab') === 'followups') focus = { type: 'owner_followups', owner, month };

    if (focus) appendState(target, 'dashboardFocus', focus);
    return target;
  }

  if (pathname === '/finance') {
    const contractId = String(params.get('contractId') || '').trim();
    const filter = String(params.get('filter') || '').trim();
    const analysis = String(params.get('analysis') || '').trim();
    const status = String(params.get('status') || '').trim();
    const view = String(params.get('view') || '').trim();

    if (status === 'draft') {
      return {
        pathname: '/finance/settlements',
        state: {
          dashboardFocus: { type: 'settlement_status', settlementStatus: 'draft' }
        }
      };
    }

    let focus: DashboardFocus | null = null;
    if (view === 'receivable' && month) focus = { type: 'receivable_month', month, contractId };
    else if (view === 'paid' && month) focus = { type: 'paid_month', month, contractId };
    else if (status === 'overdue') focus = { type: 'overdue', contractId };
    else if (params.get('range') === '30d') focus = { type: 'next_30_days', contractId };
    else if (filter === 'no_contract_amount') focus = { type: 'no_contract_amount' };
    else if (filter === 'progress_abnormal') focus = { type: 'progress_abnormal' };
    else if (analysis) focus = { type: 'analysis', analysis };

    if (focus) appendState(target, 'dashboardFocus', focus);
    if (contractId) appendState(target, 'openDetailId', contractId);
    return target;
  }

  if (pathname === '/knowledge') {
    const docId = String(params.get('docId') || '').trim();
    const focusKey = String(params.get('focus') || '').trim();
    const category = String(params.get('category') || '').trim();

    if (docId) appendState(target, 'openDetailId', docId);

    let focus: DashboardFocus | null = null;
    if (focusKey === 'ai_ready') focus = { type: 'ai_ready' };
    else if (focusKey === 'audit_linked') focus = { type: 'audit_linked' };
    else if (category) focus = { type: 'category', category };

    if (focus) appendState(target, 'dashboardFocus', focus);
    return target;
  }

  if (pathname === '/strategy') {
    const tab = String(params.get('tab') || '').trim();
    const status = String(params.get('status') || '').trim();

    let focus: DashboardFocus | null = null;
    if (tab === 'analysis') focus = { type: 'analysis', tab };
    else if (tab === 'execution' && status) focus = { type: 'execution_status', tab, status };
    else if (tab === 'execution') focus = { type: 'execution', tab };

    if (focus) appendState(target, 'dashboardFocus', focus);
    return target;
  }

  if (pathname === '/ai-center') {
    const panel = String(params.get('panel') || '').trim();
    if (panel) {
      appendState(target, 'dashboardFocus', { type: 'panel', panel });
    }
    return target;
  }

  return target;
};

export const openDashboardRoute = (navigate: NavigateFunction, route: string) => {
  const target = buildDashboardRouteTarget(route);
  if (target.state) {
    navigate({ pathname: target.pathname, search: target.search || '' }, { state: target.state });
    return;
  }
  navigate(`${target.pathname}${target.search || ''}`);
};
