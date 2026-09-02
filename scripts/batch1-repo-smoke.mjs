// 批次1 repo 冒烟：直接打实库，验证映射/单位/JSON/日期/兜底字段。
// 用法： XINYI_DB_URL=postgres://xinyi:xinyi_dev_pwd@localhost:5432/xinyi node scripts/batch1-repo-smoke.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { leadRepo } = require('../server/repos/leadRepo.js');
const { customerRepo } = require('../server/repos/customerRepo.js');
const { query } = require('../server/db/pool.js');

const assert = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ✓ ' + msg); };

const run = async () => {
  console.log('=== 线索 repo ===');
  const created = await leadRepo.create({
    name: '张三', company: '测试塑料编织厂', potentialValue: 88888.5, score: 75,
    intent: 'High', industry: '塑料编织制品制造业', unifiedSocialCreditCode: 'TESTUSCC0001',
    lastContact: '2026-06-30', contacts: [{ id: 'c1', name: '张三', isPrimary: true }],
    targetCertExpiryDate: '2027-01-01', // 未建列字段 → 应进 extra_fields
    foundingDate: '2010-05-01'
  });
  assert(created.id?.startsWith('L-'), '自动生成 id: ' + created.id);
  assert(created.potentialValue === 88888.5, '金额元值往返一致(元↔分): ' + created.potentialValue);
  assert(created.targetCertExpiryDate === '2027-01-01', 'extra_fields 兜底字段读回: ' + created.targetCertExpiryDate);
  assert(created.lastContact === '2026-06-30', '日期格式 YYYY-MM-DD: ' + created.lastContact);
  assert(Array.isArray(created.contacts) && created.contacts[0].name === '张三', 'JSON 数组往返: ' + JSON.stringify(created.contacts));

  // 校验 DB 真存的是「分」
  const raw = await query('SELECT potential_value_amount FROM leads WHERE id = $1', [created.id]);
  assert(Number(raw.rows[0].potential_value_amount) === 8888850, 'DB 实存为分: ' + raw.rows[0].potential_value_amount);

  const updated = await leadRepo.update(created.id, { status: 'Pending', score: 90 });
  assert(updated.status === 'Pending' && updated.score === 90, 'update 生效: ' + updated.status + '/' + updated.score);

  const withFu = await leadRepo.addFollowUp(created.id, { id: 'F1', date: '2026-06-30', type: '电话', content: '首次沟通', operator: 'ai-agent' });
  assert(withFu.followUpRecords.length === 1, 'addFollowUp 追加成功');

  const byUscc = await leadRepo.findByUscc('TESTUSCC0001');
  assert(byUscc?.id === created.id, 'findByUscc 命中');

  const list = await leadRepo.list({ status: 'Pending' });
  assert(list.some((l) => l.id === created.id), 'list 过滤命中');

  console.log('=== 客户 repo ===');
  const cust = await customerRepo.create({
    name: '测试塑料编织厂', contactPerson: '张三', totalAmount: 120000, level: 'A',
    riskStatus: 'low', certificates: [{ id: 'cert1', name: 'ISO9001', expiryDate: '2027-06-01', status: 'Valid' }]
  });
  assert(cust.totalAmount === 120000, '客户金额往返: ' + cust.totalAmount);
  const craw = await query('SELECT total_amount FROM customers WHERE id = $1', [cust.id]);
  assert(Number(craw.rows[0].total_amount) === 12000000, '客户金额 DB 实存为分: ' + craw.rows[0].total_amount);
  assert(cust.certificates[0].name === 'ISO9001', '客户证书 JSON 往返');

  console.log('=== 清理测试数据 ===');
  await query('DELETE FROM leads WHERE id = $1', [created.id]);
  await query('DELETE FROM customers WHERE id = $1', [cust.id]);
  console.log('  ✓ 已清理');

  console.log('\n✅ 批次1 repo 冒烟全部通过');
  process.exit(0);
};

run().catch((e) => { console.error('\n❌ ' + e.message); console.error(e); process.exit(1); });
