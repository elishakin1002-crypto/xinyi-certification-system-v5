import fs from 'node:fs/promises';
import path from 'node:path';

const parseArgs = () => new Map(
  process.argv
    .slice(2)
    .map((arg) => arg.match(/^--([^=]+)=(.*)$/))
    .filter(Boolean)
    .map(([, key, value]) => [String(key), String(value)])
);

const args = parseArgs();
const reportPath = String(args.get('report') || process.env.TEST_ENV_ACCEPTANCE_REPORT || '').trim();
const outPath = String(args.get('out') || process.env.TEST_ENV_ACCEPTANCE_RECORD || '').trim();

const escapeCell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
const mark = (value) => (value ? '通过' : '不通过');
const conclusion = (summary) => Number(summary?.fail || 0) === 0 ? '可进入业务测试' : '暂缓进入业务测试';

const formatResults = (results = []) => results.map((item) => (
  `| \`${escapeCell(item.id)}\` | ${escapeCell(item.name)} | ${mark(item.pass)} | ${escapeCell(item.code)} | ${escapeCell(item.elapsedMs)} |`
)).join('\n');

const buildRecord = (report, sourcePath) => {
  const summary = report.summary || {};
  const results = Array.isArray(report.results) ? report.results : [];
  const generatedAt = report.generatedAt || summary.generatedAt || new Date().toISOString();
  const failCount = Number(summary.fail || 0);

  return `# 测试环境验收记录

## 基本信息

| 项 | 内容 |
|---|---|
| 验收日期 | ${escapeCell(generatedAt)} |
| 验收人 |  |
| 代码版本/提交号 |  |
| 部署平台 |  |
| 测试域名 | ${escapeCell(report.frontendBase || '')} |
| 后端地址 | ${escapeCell(report.backendBase || '')} |
| 数据库 | ${escapeCell(report.expectedStateMode || '')} |
| 认证存储 | ${escapeCell(report.expectedAuthMode || '')} |
| 验收结论 | ${conclusion(summary)} |

## 自动验收摘要

| 项 | 内容 |
|---|---|
| 报告来源 | ${escapeCell(path.relative(process.cwd(), sourcePath))} |
| 总项 | ${escapeCell(summary.total ?? results.length)} |
| 通过 | ${escapeCell(summary.pass ?? results.filter((item) => item.pass).length)} |
| 失败 | ${escapeCell(failCount)} |
| 脱敏 | ${report.redaction?.enabled ? '已启用' : '未启用'} |

## 自动验收明细

| 步骤 | 名称 | 结果 | exit code | 耗时 ms |
|---|---|---|---:|---:|
${formatResults(results)}

## 人工业务验收

| 链路 | 操作步骤 | 结果 | 证据 |
|---|---|---|---|
| 登录 | 管理员登录并进入工作台 | 待验收 |  |
| 线索 | 新增线索，刷新后仍存在 | 待验收 |  |
| 线索转化 | 线索转客户或生成跟进项目 | 待验收 |  |
| 合同 | 新建合同，确认客户、项目、财务链路出现 | 待验收 |  |
| 财务 | 回款状态更新后刷新仍保留 | 待验收 |  |
| 员工 | 创建普通测试员工，首次登录强制改密 | 待验收 |  |
| 审计 | 创建员工、重置密码等动作有审计记录 | 待验收 |  |

## 风险与遗留

| 风险 | 影响 | 处理计划 | 负责人 |
|---|---|---|---|
|  |  |  |  |

## 结论

\`\`\`text
结论：${conclusion(summary)}
理由：自动验收 ${failCount === 0 ? '全部通过' : `存在 ${failCount} 项失败`}；人工业务验收待补充。
未关闭风险：
下一步：
\`\`\`

说明：如果人工验收发现 UI、DOM、demo 结构或字段异常，先记录页面、截图、账号、操作步骤和期望结果，不直接修改。
`;
};

const run = async () => {
  if (!reportPath) {
    console.error('[acceptance-record] ERROR: --report=<path> or TEST_ENV_ACCEPTANCE_REPORT is required');
    process.exit(1);
  }

  const resolvedReport = path.resolve(process.cwd(), reportPath);
  let report;
  try {
    report = JSON.parse(await fs.readFile(resolvedReport, 'utf8'));
  } catch (error) {
    console.error(`[acceptance-record] ERROR: failed to read report: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const defaultOut = path.join(
    'acceptance-reports',
    `acceptance-record-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.md`
  );
  const resolvedOut = path.resolve(process.cwd(), outPath || defaultOut);
  await fs.mkdir(path.dirname(resolvedOut), { recursive: true });
  await fs.writeFile(resolvedOut, buildRecord(report, resolvedReport));
  console.log(`[acceptance-record] record=${resolvedOut}`);
};

run().catch((error) => {
  console.error(`[acceptance-record] ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
