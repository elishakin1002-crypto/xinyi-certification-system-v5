/**
 * 建立真实员工账号（P0-20）。
 *
 * ── 为什么全给「咨询顾问」────────────────────────────────────
 * 在职员工表上只有两个岗位：咨询师 ×10、总经理助理 ×1。
 * 与其猜谁还兼着别的活，不如**先按表上写的开，别的以后加**——
 * 员工页的角色是多选按钮，随时点进去补一个角色就行。
 *
 * 少开权限的代价是「某人暂时干不了某件事」，一句话就能补上；
 * 多开权限的代价是「合同金额被不该看的人看到了」，那个补不回来。
 *
 * ── 密码 ────────────────────────────────────────────────
 * 随机生成，**只写进本地文件，不打印到终端、不进代码库**。
 * 所有账号 mustChangePassword=true：同事第一次登录被强制改密，
 * 改完才能进系统，所以初始密码泄不泄露影响有限。
 *
 * 用法：
 *   node scripts/seed-employees.mjs            # 只看要建什么，不写库
 *   node scripts/seed-employees.mjs --apply    # 真的建
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');

// 只取需要的键。dotenv 会把 .env.local 里的会话开关一起灌进来，
// 那会让脚本走上和生产不一样的路径——测试库那次已经踩过一回。
for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^(XINYI_DB_URL|AUTH_STORE_PATH|XINYI_AUTH_STORE_PATH|PGSSLMODE)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const store = require(path.join(root, 'server/authStore.js'));

/** 花名册（信义在职员工表，2026-08）。曾云俊是总经理，用现有的管理员账号，不在此列 */
const ROSTER = [
  { name: '林元波', username: 'linyuanbo', post: '咨询师' },
  { name: '曾瑞锨', username: 'zengruixian', post: '咨询师' },
  { name: '陈诗蕾', username: 'chenshilei', post: '咨询师' },
  { name: '黄佳佳', username: 'huangjiajia', post: '咨询师' },
  { name: '商春姿', username: 'shangchunzi', post: '咨询师' },
  { name: '黄邦煜', username: 'huangbangyu', post: '咨询师' },
  { name: '温婵然', username: 'wenchanran', post: '咨询师' },
  { name: '商德场', username: 'shangdechang', post: '咨询师' },
  { name: '郑园园', username: 'zhengyuanyuan', post: '咨询师' },
  { name: '梁杰', username: 'liangjie', post: '咨询师' },
  { name: '李智薇', username: 'lizhiwei', post: '总经理助理' },
  /*
    金小雁：法定代表人、80% 大股东、老板（曾云俊）的太太，实际经手开票。
    给财务角色而不是老板角色——开票和确认到账是同一件事的两头，她做最顺；
    而派活、改任务、管账号不是她在做的事，不必给。

    这也让「确认回款到账」有了两个人能做。曾云俊常年在外跑业务，
    只有他一个人能确认的话，那一步会一直压着。
  */
  { name: '金小雁', username: 'jinxiaoyan', post: '财务' },
  /*
    陈小敏：负责生产许可，不是在册员工，但她经手的项目有金额，
    要算进公司的整体数。她本人不排斥用系统，只是不愿朝九晚五坐班——
    系统里没有考勤，给她的是一个记录项目的入口，不是打卡机。
  */
  { name: '陈小敏', username: 'chenxiaomin', post: '咨询师' },
];

/*
  岗位 → 角色。

  总助（MANAGER）已经覆盖了咨询顾问的全部动作，所以不必再叠一个 CONSULTANT——
  多写一个角色不会多给权限（取并集），但会让「这人到底是干嘛的」变模糊。
*/
const ROLE_OF_POST = { 咨询师: ['CONSULTANT'], 总经理助理: ['MANAGER'], 财务: ['FINANCE'] };

/**
 * 初始密码。
 * 去掉了 0/O/1/l/I —— 这串密码要靠人念给同事听或抄在纸上，
 * 分不清的字符会变成「登不进去」的支持电话。
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const tempPassword = () =>
  Array.from(crypto.randomBytes(12)).map((b) => ALPHABET[b % ALPHABET.length]).join('');

const apply = process.argv.includes('--apply');

/**
 * 后端在跑的时候**绝对不能**执行这个脚本。
 *
 * ── 2026-08-28 就是这么丢掉 11 个账号的 ──────────────────────
 * authStore 把整份账号表读进内存（`let store`，只在启动时读一次），
 * 每次写入都是把内存里那份**整个**倒回文件。
 *
 * 于是：这个脚本从另一个进程往文件里写了 11 个账号，
 * 而正在跑的后端手里还是启动时那份「2 个账号」的旧副本——
 * 它后来因为会话续期写了一次文件，就把 11 个账号全盖掉了。
 * 不报错、不提示，等到两天后有人问「账号建好了吗」才发现。
 *
 * 同一份数据两处存储，后写的盖掉先写的。这条防护是唯一可靠的拦法：
 * **让这种情况根本不可能发生**，而不是指望执行的人记得先停服务。
 */
const assertBackendStopped = async () => {
  const bases = ['http://localhost:3001', 'http://127.0.0.1:3001'];
  for (const base of bases) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      await fetch(`${base}/api/auth/me`, { signal: ctrl.signal });
      clearTimeout(t);
      console.error(`\n❌ 后端正在运行（${base}），拒绝执行。\n`);
      console.error('原因：后端把整份账号表缓存在内存里，它下一次写文件会把这里新建的账号全部覆盖掉。');
      console.error('2026-08-28 已经这么丢过一次 11 个账号，没有任何报错。\n');
      console.error('正确顺序：');
      console.error('  1. 停掉后端');
      console.error('  2. node scripts/seed-employees.mjs --apply');
      console.error('  3. 重新启动后端（它会读到新的账号）\n');
      process.exit(2);
    } catch (e) {
      if (e?.name === 'AbortError') continue;   // 超时当成没在跑
      // 连接被拒 = 没在跑，正是我们要的
    }
  }
};

const main = async () => {
  if (apply) await assertBackendStopped();
  const existing = await store.listUsers();
  const taken = new Set(existing.map((u) => String(u.username || '').toLowerCase()).filter(Boolean));

  const todo = ROSTER.filter((p) => !taken.has(p.username));
  const skipped = ROSTER.filter((p) => taken.has(p.username));

  console.log(`\n花名册 ${ROSTER.length} 人 · 库里已有 ${existing.length} 个账号`);
  if (skipped.length) console.log(`已存在，跳过：${skipped.map((p) => p.name).join('、')}`);

  console.log(`\n${apply ? '开始创建' : '预演（不写库）'} ${todo.length} 个账号：`);
  for (const p of todo) {
    console.log(`  ${p.name.padEnd(5)} ${p.username.padEnd(15)} ${p.post.padEnd(7)} → ${ROLE_OF_POST[p.post].join(',')}`);
  }

  if (!apply) {
    console.log('\n确认无误后加 --apply 真正创建。');
    process.exit(0);
  }

  const created = [];
  for (const p of todo) {
    const password = tempPassword();
    const user = await store.createUser({
      name: p.name,
      username: p.username,
      password,
      roles: ROLE_OF_POST[p.post],
      activeRole: ROLE_OF_POST[p.post][0],
      positionTags: [p.post],          // 岗位原文留一份，将来分工细化时是线索
      status: 'active',
      mustChangePassword: true,
    });
    created.push({ ...p, password, id: user.id });
    console.log(`  ✅ ${p.name}`);
  }

  // 密码清单只落到本地文件。终端输出会留在会话记录里，代码库更不能进
  const outPath = path.join(process.env.HOME || root, 'Downloads', '员工账号初始密码.txt');
  const lines = [
    '信义管理系统 · 员工账号',
    `生成时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    '登录地址：（部署后填写）',
    '第一次登录会强制要求改密码，改完才能进系统。',
    '',
    '姓名        登录名             初始密码       角色',
    '─'.repeat(64),
    ...created.map((c) =>
      `${c.name.padEnd(10)}  ${c.username.padEnd(16)}  ${c.password.padEnd(14)} ${ROLE_OF_POST[c.post].join(',')}`),
    '',
    '※ 分发完请删除本文件。',
  ];
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');

  console.log(`\n创建完成 ${created.length} 个。`);
  console.log(`初始密码清单：${outPath}`);
  console.log('（密码不打印在这里，分发完请删掉那个文件）');
  process.exit(0);
};

main().catch((e) => { console.error('失败：', e.message); process.exit(1); });
