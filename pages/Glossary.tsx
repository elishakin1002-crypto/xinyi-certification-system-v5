/**
 * 字段档案 —— 系统里每个数字数的是什么。
 *
 * ── 为什么要在系统里，而不是一份 Word（2026-09-18）──────────────
 *
 * 金恩来：「系统的字段的解释或者定义你可以生成一份档案，放在系统中。」
 *
 * 放在系统里的理由不只是方便：**人需要解释的那一刻，是他正盯着
 * 一个对不上的数字的时候。** 那一刻他不会去翻共享盘里的文档，
 * 他会直接问同事「这个数怎么来的」——然后两个人一起猜。
 *
 * 内容全部来自 `src/modules/help/fieldDictionary.ts`，
 * 而那份字典的词条名是从代码常量里取的，配一条双向测试卡死：
 * 代码里有的词档案里必须有解释，档案里的词代码里必须还在用。
 * 所以这一页**不可能过期** —— 过期了测试先红。
 */
import React, { useMemo, useState } from 'react';
import { BookOpen, Search, AlertTriangle } from 'lucide-react';
import { FIELD_DICTIONARY } from '../src/modules/help/fieldDictionary';
import { EmptyState } from '../src/ui';

/** 口径里用 **粗体** 标关键词，这里渲染出来 —— 人扫一眼就知道重点在哪 */
const RichText: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**')
        ? <b key={i} className="text-gray-900">{part.slice(2, -2)}</b>
        : <React.Fragment key={i}>{part}</React.Fragment>
    )}
  </>
);

const Glossary: React.FC = () => {
  const [q, setQ] = useState('');

  const sections = useMemo(() => {
    const key = q.trim();
    if (!key) return FIELD_DICTIONARY;
    return FIELD_DICTIONARY
      .map(s => ({
        ...s,
        entries: s.entries.filter(e =>
          e.term.includes(key) || e.口径.includes(key) || (e.易误解 || '').includes(key))
      }))
      .filter(s => s.entries.length > 0);
  }, [q]);

  const total = FIELD_DICTIONARY.reduce((n, s) => n + s.entries.length, 0);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-indigo-600" /> 字段档案
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          系统里每个数字数的是什么、不包括什么、最容易误解成什么。共 {total} 条。
        </p>
        <p className="text-xs text-gray-400 mt-1">
          两个数字对不上的时候先查这里 —— 多半不是系统错了，是两张卡的口径不同。
        </p>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="搜一个词，比如「回款率」「本周」「逾期」"
          className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none"
        />
      </div>

      {sections.length === 0 && (
        <EmptyState
          icon={<Search className="w-8 h-8" />}
          title={`没有匹配「${q}」的词条`}
          hint="换个说法试试（比如只搜「回款」「逾期」）。界面上看得到、这里却查不到的词，说明档案漏了 —— 告诉技术负责人补上，那是档案的 bug，不是你没找到。"
        />
      )}

      {sections.map(section => (
        <div key={section.id} className="bg-white rounded-2xl border border-gray-100 p-5">
          <h2 className="text-sm font-black text-gray-900 mb-1">{section.title}</h2>
          {section.intro && (
            <p className="text-xs text-gray-500 mb-3"><RichText text={section.intro} /></p>
          )}
          <dl className="divide-y divide-gray-50">
            {section.entries.map(e => (
              <div key={section.id + e.term} className="py-3">
                <dt className="text-sm font-bold text-gray-900">{e.term}</dt>
                <dd className="text-sm text-gray-600 mt-1"><RichText text={e.口径} /></dd>
                {e.易误解 && (
                  <dd className="mt-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 flex gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span><RichText text={e.易误解} /></span>
                  </dd>
                )}
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
};

export default Glossary;
