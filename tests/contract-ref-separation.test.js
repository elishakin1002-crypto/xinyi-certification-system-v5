// contractRef 职责边界：**只存真实合同 ID，不存来源前缀**。
//
// ── 之前是什么样 ────────────────────────────────────────────────
// contract_ref 被当成多态字段用：
//   CT-xxx     真实合同 ID
//   LEAD:xxx   来源前缀（线索）
//   INTEL:xxx  来源前缀（情报）
//   CUST:xxx   来源前缀（客户）
// 而后加的 source_type + source_ref 表达的是同一件事。
//
// 同一份信息两处存储，必然漂移——实测出现过「前缀写 CUST 而 source_type
// 是 customer」这类对不上的记录（连大小写口径都不统一）。
// 27 个项目里有 12 个的 contract_ref 装的根本不是合同。
//
// 现在：contractRef 只存合同 ID 或空，来源统一走 sourceType/sourceRef。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

test('新建跟进项目时不再往 contractRef 里塞来源前缀', () => {
  const src = read('server/services/convertSignal.js');
  assert.ok(!/contractRef:\s*`INTEL:/.test(src),
    '情报转项目又把 INTEL: 前缀写进 contractRef 了——那是合同字段，不是来源字段');
  assert.match(src, /sourceType: 'intel'/, '来源要写进 sourceType');
  assert.match(src, /contractRef: ''/, '没有合同就该留空，而不是塞个前缀进去');
});

test('找客户时优先读 sourceType，前缀只作旧数据兜底', () => {
  const src = read('server/services/completeProject.js');
  assert.match(src, /project\.sourceType/, '没有读 sourceType');
  assert.match(src, /legacyPrefix/, '旧数据兜底逻辑不见了——存量里还有老记录');
  // 不能只认前缀
  assert.ok(!/if \(ref\.startsWith\('CUST:'\)\) \{\s*\n\s*targetCustomerId = ref\.split/.test(src),
    '还在直接按前缀取客户 ID，没走 sourceType');
});

test('迁移只清「来源信息确实存在别处」的记录', () => {
  /*
    清空一个字段前必须确认信息没丢。
    迁移的 WHERE 要求 source_type 和 source_ref 都非空——
    只有来源已经安全地存在另一处时才清前缀。
    库里还有 3 条既无合同也无来源的空壳项目，它们没被这条迁移碰过。
  */
  const sql = read('db/migrations/016_contractRef职责分离.sql');
  assert.match(sql, /source_type[\s\S]{0,80}<>\s*''/, '迁移没有校验 source_type 非空');
  assert.match(sql, /source_ref[\s\S]{0,80}<>\s*''/, '迁移没有校验 source_ref 非空');
  assert.ok(!/DELETE FROM projects/i.test(sql), '这条迁移不该删记录，只该清字段');
});

test('旧数据解析函数仍然保留，存量还在用', () => {
  /*
    parseLegacyProjectRef 不能删：库里可能还有没迁到的老记录，
    备份恢复回来的数据也可能带前缀。
    职责分离说的是「新数据不再这么写」，不是「立刻不认旧格式」。
  */
  const src = read('src/utils/projectCapabilities.ts');
  assert.match(src, /parseLegacyProjectRef/, '旧格式解析被删了，老记录会认不出来源');
  assert.match(src, /LEAD:/, '解析函数要能认出旧前缀');
});
