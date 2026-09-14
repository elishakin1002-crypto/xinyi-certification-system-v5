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
 * 逾期的 / 今天到期的 / 这周的 / 以后的。
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
  const [scope, setScope] = useState<'mine' | 'assigned' | 'all'>('mine');
  const [statusFilter, setStatusFilter] = useState<'open' | 'doing' | 'all'>('open');
  const [search, setSearch] = useState('');
  const [showLater, setShowLater] = useState(false);

  const me = String(currentUser?.name || '').trim();

  /** 我是不是这个项目的负责人 */
  const iOwnProject = (project: Project) => (
    project.ownerUserId && currentUser?.id
      ? project.ownerUserId === currentUser.id
      : String(project.manager || '').trim() === me
  );

  /** 这条任务是不是我的。姓名和用户 ID 都认 —— 老数据只有姓名 */
  const isMine = (task: ProjectTask, project: Project) => {
    const owner = String(task.owner || '').trim();
    if (owner && me) return owner === me;
    // 任务没写负责人时，算项目负责人的
    if (!owner) return iOwnProject(project);
    return false;
  };

  /**
   * 「我派出去的」：我负责的项目里，派给别人的任务。
   *
   * ── 为什么加这一档（2026-09-08）──────────────────────────────
   *
   * 金恩来问：「每个人可以看到全公司的任务合适吗？对提高工作效率有帮助吗？」
   *
   * 想清楚之后：**看全公司的任务清单，对绝大多数人没用**。
   * 别人的任务你既改不了也不该改，翻一遍只是消耗注意力。
   *
   * 但「全公司」底下藏着一个**真需求**：项目负责人想知道
   * 「我派给别人的活做了没」。原来只能切到全公司再自己一条条挑，
   * 那正是把噪音塞给他之后再让他自己过滤。
   *
   * 所以把那个真需求单独做成一档 —— 它才是项目负责人每天要看的。
   */
  const isAssignedByMe = (task: ProjectTask, project: Project) => {
    if (!iOwnProject(project)) return false;
    const owner = String(task.owner || '').trim();
    return Boolean(owner) && owner !== me;
  };

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    (projects || []).forEach(p => {
      (p.tasks || []).forEach(t => {
        if (scope === 'mine' && !isMine(t, p)) return;
        if (scope === 'assigned' && !isAssignedByMe(t, p)) return;
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

  const renderRow = ({ task, project }: Row, sample = false) => {
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
            disabled={sample || !checkActionPermission('TASK_COMPLETE', project).allowed}
            onChange={(u) => { if (!sample) updateProjectTask(project.id, task.id, u); }}
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
              onClick={() => { if (!sample) navigate('/projects', { state: { openDetailId: project.id } }); }}
              className="inline-flex items-center gap-1 text-indigo-600 hover:underline"
            >
              {project.name}
              <ArrowRight className="h-3 w-3" />
            </button>
            <span className="text-gray-300">·</span>
            <span className={overdue ? 'text-red-600' : ''}>
              {task.deadline || '没定日期'}
              {overdue && ' 已逾期'}
            </span>
            {scope !== 'mine' && task.owner && (
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
        <div>{list.map(row => renderRow(row))}</div>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-6" data-guide-id="my-tasks">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">我的任务</h1>
        {/*
          两页的分工要写在脸上，不能只活在设计者脑子里。

          金恩来 2026-09-08：「项目管理和我的任务页面是不是太像了？」
          确实像 —— 两边都能勾任务。但它们看的是**同一批数据的两种角度**：
            项目管理  按「事」分：这一单活的全貌
            我的任务  按「时间」排：我今天先干哪件
          不说清楚，人会以为是两套东西，然后开始怀疑「我在这边勾了，
          那边会不会没记上」。
        */}
        <p className="mt-1 text-sm text-gray-500">
          <span className="font-bold text-gray-700">按「时间」看：</span>
          所有项目里写着你名字的活，抄成一张清单按日子排好。逾期的在最上面，先处理它们。
          想看某一单的全貌，去
          <button
            type="button"
            onClick={() => navigate('/projects')}
            className="mx-1 font-bold text-indigo-600 hover:underline"
          >
            项目管理
          </button>
          。
        </p>
        <p className="mt-1 text-[12px] font-bold text-gray-400">
          两边是同一批任务：在这里勾完成，项目那边立刻就变了，不用再记一遍。
        </p>
      </div>

      <StatGrid className="mb-6">
        <StatCard icon={<AlertTriangle className="h-6 w-6" />} value={buckets.overdue.length} label="已逾期" emphasis={buckets.overdue.length > 0 ? 'danger' : undefined} title="过了截止日期还没做完的" />
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
              { value: 'assigned' as const, label: '我派出去的', title: '我负责的项目里、派给别人的任务 —— 看他们做了没' },
              { value: 'all' as const, label: '全公司', title: '所有人的任务。多数时候是噪音，找人顶班或接手时才用得上' },
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

      <SampleRow empty={rows.length === 0} className="mb-5" contentClassName="pt-3" caption="样例只供讲解，不会保存或计入任务数量。任务左侧显示状态，中间是任务名称，下方是所属项目与截止日期。">
        {renderRow({task: {id: 'sample-task', title: '核对客户提供的资料', status: 'Pending', deadline: '示例日期', owner: '示例顾问'}, project: {id: 'sample-project', name: '示例企业 ISO9001 服务', tasks: []}} as Row, true)}
      </SampleRow>
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <EmptyState
            title={scope === 'mine' ? '你名下没有未完成的任务'
              : scope === 'assigned' ? '你负责的项目里，没有派给别人的未完成任务'
              : '没有符合条件的任务'}
            hint={scope === 'mine'
              ? '要么确实做完了，要么任务还没派到你名下 —— 去项目里看看，或者问一下项目负责人。'
              : scope === 'assigned'
                ? '要么都做完了，要么这些项目的任务都在你自己名下 —— 那也说明没人替你分担。'
                : '换个筛选条件试试。'}
          />

        </div>
      ) : (
        <>
          {section('已逾期', '过了日子还没做完 —— 先处理这里', buckets.overdue, 'bg-red-50 text-red-800', <AlertTriangle className="h-4 w-4" />)}
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
