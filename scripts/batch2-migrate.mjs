// 批次2 数据迁移：state_store 的 projects/reminders/knowledge → PG。幂等：id 存在则跳过。
// 用法： XINYI_DB_URL=... node scripts/batch2-migrate.mjs [--dry]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const { projectRepo } = require('../server/repos/projectRepo.js');
const { reminderRepo } = require('../server/repos/reminderRepo.js');
const { knowledgeRepo } = require('../server/repos/knowledgeRepo.js');

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
  let created = 0, skipped = 0, failed = 0;
  for (const rec of records) {
    if (!rec || !rec.id) { skipped++; continue; }
    try {
      if (await repo.getById(rec.id)) { skipped++; continue; }
      if (!DRY) await repo.create(rec);
      created++;
    } catch (e) {
      failed++;
      if (failed <= 5) console.error(`  ! ${label} id=${rec.id} 失败: ${e.message}`);
    }
  }
  console.log(`${label}: 新增 ${created} / 跳过 ${skipped} / 失败 ${failed}（共 ${records.length}）`);
  return failed;
};

const run = async () => {
  console.log(`源: ${STATE_PATH}${DRY ? '  [DRY RUN]' : ''}\n`);
  let failed = 0;
  failed += await migrate('项目 projects', loadDataset('projects_v8'), projectRepo);
  failed += await migrate('提醒 reminders', loadDataset('reminders_v8'), reminderRepo);
  failed += await migrate('知识库 knowledge', loadDataset('knowledge_docs_v8'), knowledgeRepo);
  console.log(failed ? `\n⚠️ 完成，但有 ${failed} 条失败` : '\n✅ 迁移完成，无失败');
  process.exit(failed ? 1 : 0);
};

run().catch((e) => { console.error('❌ ' + e.message); process.exit(1); });
