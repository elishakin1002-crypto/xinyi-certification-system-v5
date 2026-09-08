import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListTodo, ArrowRight, AlertTriangle, CalendarDays, Inbox } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Project, ProjectTask } from '../types';
import { Badge, EmptyState, FilterSelect, SearchInput, StatCard, StatGrid } from '../src/ui';
import { TaskStatusControl } from '../components/TaskStatusControl';
import { SampleRow } from '../components/SampleRow';
import { isOpenTask, isOverdue, byUrgency, blockingPrerequisites } from '../src/modules/taskFlow';

/**
 * 我的任务 —— 跨项目看「我今天要干什么」。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要有这一页
 * ══════════════════════════════════════════════════════════════
 *
 * 在这之前，任务只存在于**项目详情里面**。顾问早上想知道今天要干什么，
 * 得把手上每个项目一个个点开、一个个找自己名下的任务 ——
 * 而他手上可能有五六个项目。
 *
 * 结果是可预料的：**大家不看系统，看微信群和自己的记性**。
 * 那样一来，任务的截止日期就成了摆设，延误率也就没了意义 ——
 * 因为根本没人按它干活。
 *
 * 成熟的项目工具无一例外有这么一页（My Tasks / 我的任务），
 * 而且它是**使用频率最高的界面**，不是项目列表。
 *
 * ── 为什么按「时间」分组，不按项目 ────────────────────────────
 *
 * 按项目分组，人还是得自己在几个项目之间判断先做哪个 ——
 * 而这个判断的依据本来就是时间。所以直接按时间排好：
 * 超期的 / 今天到期的 / 这周的 / 以后的。
 * 打开就知道先干哪件，不用再想一遍。
 *
 * ── 为什么默认不显示「以后」的 ────────────────────────────────
 *
 * 一次给他 60 条任务，他会关掉页面。默认只给本周该管的，
 * 后面的收起来 —— 想看再展开。
 */

type Row = { task: ProjectTask; project: Project };

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const DAY = 24 * 3600 * 1000;

const MyTasks: React.FC = () => {
  const { projects, currentUser, updateProjectTask, checkActionPermission } = useApp();
  const navigate = useNavigate();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [statusFilter, setStatusFilter] = useState<'open' | 'doing' | 'all'>('open');
  const [search, setSearch] = useState('');
  const [showLater, setShowLater] = useState(false);

  /** 这条任务是不是我的。姓名和用户 ID 都认 —— 老数据只有姓名 */
  const isMine = (task: ProjectTask, project: Project) => {
    const me = String(currentUser?.name || '').trim();
    const owner = String(task.owner || '').trim();
    if (owner && me && owner === me) return true;
    // 任务没写负责人时，算项目负责人的
    if (!owner) {
      if (project.ownerUserId && currentUser?.id) return project.ownerUserId === currentUser.id;
      return String(project.manager || '').trim() === me;
    }
    return false;
  };

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    (projects || []).forEach(p => {
      (p.tasks || []).forEach(t => {
        if (scope === 'mine' && !isMine(t, p)) return;
        if (statusFilter === 'open' && !isOpenTask(t)) return;
        if (statusFilter === 'doing' && t.status !== 'InProgress') return;
        const q = search.trim();
        if (q && !(`${t.title}${p.name}`.includes(q))) return;
        out.push({ task: t, project: p });
      });
    });
    return out.sort((a, b) => byUrgency(a.task, b.task));
  }, [projects, scope, statusFilter, search, currentUser?.name, currentUser?.id]);

  /** 按时间分四档 —— 打开就知道先干哪件 */
  const buckets = useMemo(() => {
    const t0 = startOfToday();
    const g = { overdue: [] as Row[], today: [] as Row[], week: [] as Row[], later: [] as Row[] };
    rows.forEach(r => {
      const d = new Date(String(r.task.deadline || '')).getTime();
      if (!Number.isFinite(d)) { g.later.push(r); return; }
      if (isOverdue(r.task)) { g.overdue.push(r); return; }
      if (d < t0 + DAY) { g.today.push(r); return; }
      if (d < t0 + 7 * DAY) { g.week.push(r); return; }
      g.later.push(r);
    });
    return g;
  }, [rows]);

  const doingCount = rows.filter(r => r.task.status === 'InProgress').length;

  const renderRow = ({ task, project }: Row) => {
    const blockers = blockingPrerequisites(task, project.tasks || []);
    const overdue = isOverdue(task);
    return (
      <div
        key={`${project.id}-${task.id}`}
        className={`flex items-start gap-3 border-b border-gray-50 px-4 py-3 last:border-0 ${overdue ? 'bg-red-50/40' : ''}`}
      >
        <div className="pt-0.5">
          <TaskStatusControl
            task={task}
            allTasks={project.tasks || []}
            compact
            disabled={!checkActionPermission('TASK_COMPLETE', project).allowed}
            onChange={(u) => updateProjectTask(project.id, task.id, u)}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-bold ${task.status === 'Completed' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
            {task.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold text-gray-500">
            {/* 项目名要能点 —— 看到任务时最常想的下一件事就是「这是哪个项目」 */}
            <button
              type="button"
              onClick={() => navigate('/projects', { state: { openDetailId: project.id } })}
              className="inline-flex items-center gap-1 text-indigo-600 hover:underline"
            >
              {project.name}
              <ArrowRight className="h-3 w-3" />
            </button>
            <span className="text-gray-300">·</span>
            <span className={overdue ? 'text-red-600' : ''}>
              {task.deadline || '没定日期'}
              {overdue && ' 已超期'}
            </span>
            {scope === 'all' && task.owner && (
              <>
                <span className="text-gray-300">·</span>
                <span>{task.owner}</span>
              </>
            )}
            {blockers.length > 0 && (
              <>
                <span className="text-gray-300">·</span>
                <span className="text-amber-700">前置未完成：{blockers.map(b => b.title).join('、')}</span>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  const section = (title: string, hint: string, list: Row[], tone: string, icon: React.ReactNode) => {
    if (list.length === 0) return null;
    return (
      <div className="mb-5 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className={`flex items-center gap-2 px-4 py-3 ${tone}`}>
          {icon}
          <h3 className="text-sm font-black">{title}</h3>
          <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-black">{list.length}</span>
          <span className="ml-auto text-[11px] font-bold opacity-70">{hint}</span>
        </div>
        <div>{list.map(renderRow)}</div>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-6" data-guide-id="my-tasks">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">我的任务</h1>
        <p className="mt-1 text-sm text-gray-500">
          你名下所有项目的任务放在一起，按时间排好。超期的在最上面，先处理它们。
        </p>
      </div>

      <StatGrid className="mb-6">
        <StatCard icon={<AlertTriangle className="h-6 w-6" />} value={buckets.overdue.length} label="已超期" emphasis={buckets.overdue.length > 0 ? 'danger' : undefined} title="过了截止日期还没做完的" />
        <StatCard icon={<CalendarDays className="h-6 w-6" />} value={buckets.today.length} label="今天到期" tone="amber" />
        <StatCard icon={<ListTodo className="h-6 w-6" />} value={buckets.week.length} label="本周内" tone="blue" />
        <StatCard icon={<Inbox className="h-6 w-6" />} value={doingCount} label="我正在做" tone="emerald" title="标了「进行中」的。堆太多说明同时开的头太多" />
      </StatGrid>

      <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            label="范围" value={scope} onChange={v => setScope(v)}
            options={[
              { value: 'mine' as const, label: '我的任务', title: '我名下的任务' },
              { value: 'all' as const, label: '全公司', title: '所有人的任务（只读了解，不是让你去代做）' },
            ]}
          />
          <FilterSelect
            label="状态" value={statusFilter} onChange={v => setStatusFilter(v)}
            options={[
              { value: 'open' as const, label: '未完成', title: '待开始和进行中' },
              { value: 'doing' as const, label: '只看进行中', title: '我已经开了头的' },
              { value: 'all' as const, label: '全部', title: '含已完成和已跳过' },
            ]}
          />
        </div>
        <SearchInput value={search} onChange={setSearch} placeholder="搜任务或项目…" className="w-full md:w-64" />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <EmptyState
            title={scope === 'mine' ? '你名下没有未完成的任务' : '没有符合条件的任务'}
            hint={scope === 'mine'
              ? '要么确实做完了，要么任务还没派到你名下 —— 去项目里看看，或者问一下项目负责人。'
              : '换个筛选条件试试。'}
          />
          <SampleRow empty caption="真实的一行长这样：左边勾完成、点「开始做」标记你正在做它；中间是任务名，下面能点进对应项目；红色是已经超期的。">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 block h-4 w-4 rounded-full border-2 border-gray-200" />
              <div>
                <p className="text-sm font-bold text-gray-900">整理管理手册</p>
                <p className="mt-1 text-[11px] font-bold text-gray-500">
                  温州示范包装有限公司 ISO9001 换证 · 2026-09-11
                </p>
              </div>
            </div>
          </SampleRow>
        </div>
      ) : (
        <>
          {section('已超期', '过了日子还没做完 —— 先处理这里', buckets.overdue, 'bg-red-50 text-red-800', <AlertTriangle className="h-4 w-4" />)}
          {section('今天到期', '今天之内要有结果', buckets.today, 'bg-amber-50 text-amber-800', <CalendarDays className="h-4 w-4" />)}
          {section('本周内', '这周要安排上', buckets.week, 'bg-blue-50 text-blue-800', <ListTodo className="h-4 w-4" />)}

          {/* 「以后」默认收起：一次给 60 条任务，人会直接关掉页面 */}
          {buckets.later.length > 0 && (
            showLater
              ? section('以后', '不急，但别忘了', buckets.later, 'bg-gray-50 text-gray-700', <Inbox className="h-4 w-4" />)
              : (
                <button
                  type="button"
                  onClick={() => setShowLater(true)}
                  className="w-full rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-3 text-xs font-bold text-gray-500 hover:border-gray-300 hover:text-gray-700"
                >
                  还有 {buckets.later.length} 条更远的任务，点开看
                </button>
              )
          )}
        </>
      )}
    </div>
  );
};

export default MyTasks;
