/**
 * 全站共用 UI 基础组件。
 *
 * 目的：把原本散落在各页面、各写各的元素（搜索框、状态徽章、空状态、弹窗、表格）
 * 收成一套规格，改一处全站生效。规格基准来自「不符合项管理」页。
 */
import React from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

/* ──────────────── 色板 ──────────────── */

export type Tone = 'gray' | 'blue' | 'indigo' | 'emerald' | 'amber' | 'red' | 'orange' | 'purple';

/** 浅底 + 深字 + 同色描边，用于徽章 */
export const toneChip: Record<Tone, string> = {
  gray: 'bg-gray-50 text-gray-600 border-gray-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-100',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  amber: 'bg-amber-50 text-amber-700 border-amber-100',
  red: 'bg-red-50 text-red-700 border-red-100',
  orange: 'bg-orange-50 text-orange-700 border-orange-100',
  purple: 'bg-purple-50 text-purple-700 border-purple-100'
};

/** 图标色块，用于 KPI 卡左侧 */
export const toneIcon: Record<Tone, string> = {
  gray: 'bg-gray-50 text-gray-600',
  blue: 'bg-blue-50 text-blue-600',
  indigo: 'bg-indigo-50 text-indigo-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  red: 'bg-red-50 text-red-600',
  orange: 'bg-orange-50 text-orange-600',
  purple: 'bg-purple-50 text-purple-600'
};

const toneHover: Record<Tone, string> = {
  gray: 'hover:border-gray-300',
  blue: 'hover:border-blue-200',
  indigo: 'hover:border-indigo-200',
  emerald: 'hover:border-emerald-200',
  amber: 'hover:border-amber-200',
  red: 'hover:border-red-200',
  orange: 'hover:border-orange-200',
  purple: 'hover:border-purple-200'
};

/* ──────────────── 徽章 ──────────────── */

/** 全站统一的状态徽章：胶囊形、浅底深字带描边 */
export const Badge: React.FC<{
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
  /** 悬停说明。徽章上塞不下的那半句话放这里 */
  title?: string;
}> = ({ tone = 'gray', children, className = '', title }) => (
  <span title={title} className={`inline-flex items-center px-2.5 py-1 rounded-full border text-[11px] font-bold whitespace-nowrap ${toneChip[tone]} ${className}`}>
    {children}
  </span>
);

/* ──────────────── 搜索框 ──────────────── */

export const SearchInput: React.FC<{
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}> = ({ value, onChange, placeholder = '搜索…', className = '' }) => (
  <div className={`relative ${className}`}>
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full pl-9 pr-8 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15"
    />
    {value && (
      <button
        type="button"
        onClick={() => onChange('')}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
        aria-label="清除搜索"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    )}
  </div>
);

/* ──────────────── 筛选下拉 ──────────────── */

/**
 * 列表页的筛选控件。
 *
 * ── 为什么从一排按钮改成下拉（2026-09-07）────────────────────
 *
 * 金恩来：「弄一堆按钮在上面也挺抢重点的……一切设计不要画蛇添足，
 * 要以方便和效率为主。」
 *
 * 他说的是对的，而且不只是好看不好看的问题：
 * 项目管理页顶部原来有 9 个同样大小、同样加粗的按钮，
 * 它们和「新建项目」抢的是同一份注意力 ——
 * 而 9 个里通常只有 1 个是当前生效的档位，另外 8 个是噪音。
 *
 * 下拉的好处是**收起来的时候只显示当前选中的那一档**：
 * 「状态：全部状态」本身就是一句话，不用再去按钮堆里找哪个是高亮的。
 * 手机上更明显 —— 9 个按钮要横向滚动，下拉只占一行，
 * 而且调用的是系统自带的选择器，比自己画的浮层好按。
 *
 * 用原生 `<select>` 不是偷懒：自绘浮层要处理点外面关闭、键盘、
 * 滚动跟随、屏幕边缘翻转，多写几百行只为了换个箭头样式 ——
 * 那才是画蛇添足。
 */
export const FilterSelect = <T extends string>({
  label,
  value,
  onChange,
  options,
  className = ''
}: {
  /** 这一组在筛什么，比如「状态」。收起来时和选中项一起显示 */
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string; title?: string }[];
  className?: string;
}) => {
  const active = options.find(o => o.value === value);
  return (
    <label
      className={`group relative inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white pl-3 pr-8 py-2 cursor-pointer transition-colors hover:border-indigo-300 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-500/15 ${className}`}
      title={active?.title}
    >
      <span className="text-[11px] font-bold text-gray-400 whitespace-nowrap">{label}</span>
      <span className="text-sm font-bold text-gray-800 whitespace-nowrap">{active?.label || ''}</span>
      {/* 真正的 select 铺满整块并透明 —— 点哪里都能展开，手机上也是系统选择器 */}
      <select
        value={value}
        onChange={e => onChange(e.target.value as T)}
        aria-label={label}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
    </label>
  );
};

/* ──────────────── 空状态 ──────────────── */

export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  compact?: boolean;
}> = ({ icon, title, hint, action, compact = false }) => (
  <div className={`flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 ${compact ? 'py-6 px-4' : 'py-12 px-6'}`}>
    {icon && <div className="mb-3 text-gray-300">{icon}</div>}
    <div className={`font-bold text-gray-500 ${compact ? 'text-xs' : 'text-sm'}`}>{title}</div>
    {hint && <div className="mt-1.5 text-xs text-gray-400 max-w-md leading-6">{hint}</div>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

/* ──────────────── 卡片 ──────────────── */

/** 页面主区块容器：标题 + 说明 + 右侧操作 + 内容 */
export const SectionCard: React.FC<{
  title?: React.ReactNode;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}> = ({ title, subtitle, icon, actions, children, className = '', bodyClassName = '' }) => (
  <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 ${className}`}>
    {(title || actions) && (
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-5 pb-0">
        <div className="min-w-0">
          {title && (
            <h2 className="text-lg font-black text-gray-900 flex items-center">
              {icon && <span className="mr-2 shrink-0">{icon}</span>}
              {title}
            </h2>
          )}
          {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </div>
    )}
    <div className={bodyClassName || 'p-5'}>{children}</div>
  </div>
);

/** KPI 统计卡 */
export const StatCard: React.FC<{
  icon: React.ReactNode;
  value: React.ReactNode;
  label: React.ReactNode;
  tone?: Tone;
  /** 渐变强调卡：每行最多一张，用于最该关注的指标 */
  emphasis?: 'none' | 'primary' | 'danger' | 'warning';
  onClick?: () => void;
  title?: string;
  selected?: boolean;
}> = ({ icon, value, label, tone = 'blue', emphasis = 'none', onClick, title, selected = false }) => {
  const Tag = onClick ? 'button' : 'div';
  if (emphasis !== 'none') {
    const gradient = emphasis === 'danger'
      ? 'from-rose-500 to-red-600'
      : emphasis === 'warning'
        ? 'from-amber-500 to-orange-600'
        : 'from-indigo-600 to-blue-700';
    return (
      <Tag
        {...(onClick ? { type: 'button' as const, onClick } : {})}
        title={title}
        aria-pressed={onClick ? selected : undefined}
        className={`text-left relative ${selected ? 'ring-2 ring-blue-600 ring-offset-2' : ''} p-5 rounded-2xl shadow-lg flex items-center text-white bg-gradient-to-br ${gradient} ${onClick ? 'transition-transform active:scale-[0.98]' : ''}`}
      >
        <div className="p-3 bg-white/20 rounded-xl mr-4 shrink-0">{icon}</div>
        <div className="min-w-0">
          {selected && <span className="absolute right-3 top-2 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">已选中</span>}
          <div className="text-2xl font-black truncate">{value}</div>
          <div className="text-xs opacity-80 font-bold uppercase tracking-tight">{label}</div>
        </div>
      </Tag>
    );
  }
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      title={title}
        aria-pressed={onClick ? selected : undefined}
      className={`text-left relative ${selected ? 'ring-2 ring-blue-600 ring-offset-2' : ''} bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center group transition-colors ${toneHover[tone]}`}
    >
      <div className={`p-3 rounded-xl mr-4 shrink-0 group-hover:scale-110 transition-transform ${toneIcon[tone]}`}>{icon}</div>
      <div className="min-w-0">
          {selected && <span className="absolute right-3 top-2 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">已选中</span>}
        <div className="text-2xl font-black text-gray-900 truncate">{value}</div>
        <div className="text-xs text-gray-400 font-bold uppercase tracking-tight">{label}</div>
      </div>
    </Tag>
  );
};

/** KPI 卡栅格：固定 4 列断点，全站一致 */
export const StatGrid: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 ${className}`}>{children}</div>
);

/* ──────────────── 页头 ──────────────── */

export const PageHeader: React.FC<{
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}> = ({ title, subtitle, actions }) => (
  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
    <div className="min-w-0">
      <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-3 shrink-0">{actions}</div>}
  </div>
);

/* ──────────────── 按钮 ──────────────── */

const buttonBase = 'inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100';

export const buttonClass = (variant: 'primary' | 'secondary' | 'danger' | 'ghost' = 'secondary') => {
  if (variant === 'primary') return `${buttonBase} bg-blue-600 text-white hover:bg-blue-700`;
  if (variant === 'danger') return `${buttonBase} bg-red-600 text-white hover:bg-red-700`;
  if (variant === 'ghost') return `${buttonBase} bg-transparent text-gray-600 shadow-none hover:bg-gray-100`;
  return `${buttonBase} bg-white text-gray-700 border border-gray-200 hover:bg-gray-50`;
};

/* ──────────────── 弹窗 ──────────────── */

export const Modal: React.FC<{
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: string;
  /** 面板最大宽度，默认 max-w-2xl */
  size?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}> = ({ open, onClose, title, subtitle, size = 'max-w-2xl', footer, children }) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className={`w-full ${size} max-h-[90vh] flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200`}
        onClick={e => e.stopPropagation()}
      >
        {(title || subtitle) && (
          <div className="flex items-start justify-between gap-4 p-5 border-b border-gray-100 shrink-0">
            <div className="min-w-0">
              {title && <h2 className="text-lg font-black text-gray-900">{title}</h2>}
              {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 shrink-0"
              aria-label="关闭"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-5">{children}</div>
        {footer && <div className="p-5 border-t border-gray-100 bg-gray-50/60 shrink-0">{footer}</div>}
      </div>
    </div>
  );
};

/* ──────────────── 表格 ──────────────── */

/** 表头：全站统一底色与字重 */
export const tableHeadClass = 'bg-gray-50/60 text-gray-500 text-[11px] font-black uppercase tracking-wider border-b border-gray-100';
/** 表头单元格 */
export const thClass = 'px-6 py-3 text-left whitespace-nowrap';
/** 表体单元格：行高统一为 py-4 */
export const tdClass = 'px-6 py-4 align-middle';
/** 表体行 */
export const trClass = 'border-b border-gray-50 last:border-0 hover:bg-gray-50/60 transition-colors';

/* ════════════════════════════════════════════════════════════════
   表单字段 —— 标签在上、输入在下的那种卡片

   ══════════════════════════════════════════════════════════════
   为什么补这一块（2026-09-20）
   ══════════════════════════════════════════════════════════════

   金恩来 2026-09-19：「手工录入按钮和智能识别按钮的大小都不统一…
     UI 不同统一你懂吗？布局不合理你知道吗？」

   查下来根因不是"没有设计规范"—— 这个文件里早就有 Badge / SectionCard /
   StatCard / buttonClass / Modal / 统一色板。**根因是我一个都没用**：
   我在证书区手写了 `rounded-xl border border-blue-200 bg-blue-50 px-3 py-2
   text-xs font-black text-blue-700`，而不是调 buttonClass()。

   而我之所以在表单上也手写，是因为**这里原来确实没有表单字段的规范**：
   一张证书里同时出现了带框输入、下划线输入、卡片包着的输入三种样式。
   没有现成的东西可用时，每个人（包括 AI）都会临时发明一个。

   所以补上这一组。配套的约束在 tests/design-system.test.js：
   新写的页面代码里再出现手搓的同款类名串，那条测试会红。
   ──「要人记住的规矩，早晚有人记不住」（CLAUDE.md 二点五之四）。
   ════════════════════════════════════════════════════════════════ */

/** 字段卡片的外壳 */
export const fieldCardClass = 'rounded-xl border border-gray-100 bg-white px-3 py-2';

/** 字段名（卡片里那行小灰字） */
export const fieldLabelClass = 'text-[11px] font-bold text-gray-400 uppercase';

/**
 * 字段里的输入框 / 下拉 / 日期框 —— 三者用同一套，不然一行里就会出现两种框。
 * tone='warn' 用在"这一项没填会出问题"的场合（例如没选证书种类就不会提醒）。
 */
export const fieldInputClass = (tone: 'normal' | 'warn' = 'normal') =>
  'mt-1 w-full rounded-lg px-2 py-1 font-bold outline-none focus:ring-2 focus:ring-indigo-100 border '
  + (tone === 'warn' ? 'border-amber-300 bg-white text-amber-700' : 'border-gray-200 bg-white text-gray-800');

/** 只读态下字段值的样子 */
export const fieldValueClass = (tone: 'normal' | 'warn' = 'normal') =>
  'mt-1 font-bold ' + (tone === 'warn' ? 'text-amber-600' : 'text-gray-800');

/**
 * 一张字段卡片。
 *
 * `span` 是在 12 栅格里占几列 —— 写死成 Tailwind 的完整类名，
 * 不用模板字符串拼（`md:col-span-${n}` 那种写法 Tailwind 扫不到，
 * 编译出来是空的，这个项目在别处栽过同样的跟头）。
 */
export const FieldCard: React.FC<{
  label: React.ReactNode;
  span?: 1 | 2 | 3 | 4;
  children: React.ReactNode;
}> = ({ label, span = 1, children }) => (
  <div className={`${fieldCardClass} ${
    span === 4 ? 'md:col-span-4' : span === 3 ? 'md:col-span-3' : span === 2 ? 'md:col-span-2' : ''
  }`}>
    <div className={fieldLabelClass}>{label}</div>
    {children}
  </div>
);
