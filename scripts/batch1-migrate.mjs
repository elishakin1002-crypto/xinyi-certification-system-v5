// 批次1 数据迁移：state_store 的 leads_v8 / customers_v8 → PG 新表。
// 复用 repo（自动元→分、JSON、extra_fields 兜底）。幂等：按 id 存在则更新，否则插入。
// 用法： XINYI_DB_URL=... node scripts/batch1-migrate.mjs [--dry]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const { leadRepo } = require('../server/repos/leadRepo.js');
const { customerRepo } = require('../server/repos/customerRepo.js');

const DRY = process.argv.includes('--dry');
const STATE_PATH = path.resolve(process.cwd(), process.env.STATE_STORE_PATH || '.runtime/state_store.json');

const loadDataset = (key) => {
  const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  const ds = raw.datasets || raw;
  const v = ds[key];
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.value)) return v.value;
  return [];
};

const migrate = async (label, records, repo) => {
  let created = 0, updated = 0, skipped = 0, failed = 0;
  for (const rec of records) {
    if (!rec || !rec.id) { skipped++; continue; }
    try {
      const exists = await repo.getById(rec.id);
      if (DRY) { exists ? updated++ : created++; continue; }
      if (exists) { await repo.update(rec.id, rec); updated++; }
      else { await repo.create(rec); created++; }
    } catch (e) {
      failed++;
      if (failed <= 5) console.error(`  ! ${label} id=${rec.id} 失败: ${e.message}`);
    }
  }
  console.log(`${label}: 新增 ${created} / 更新 ${updated} / 跳过(无id) ${skipped} / 失败 ${failed}（共 ${records.length}）`);
  return { created, updated, skipped, failed };
};

const run = async () => {
  console.log(`源: ${STATE_PATH}${DRY ? '  [DRY RUN]' : ''}\n`);
  const leads = loadDataset('leads_v8');
  const customers = loadDataset('customers_v8');
  const r1 = await migrate('线索 leads', leads, leadRepo);
  const r2 = await migrate('客户 customers', customers, customerRepo);
  const failed = r1.failed + r2.failed;
  console.log(failed ? `\n⚠️ 完成，但有 ${failed} 条失败` : '\n✅ 迁移完成，无失败');
  process.exit(failed ? 1 : 0);
};

run().catch((e) => { console.error('❌ ' + e.message); process.exit(1); });
