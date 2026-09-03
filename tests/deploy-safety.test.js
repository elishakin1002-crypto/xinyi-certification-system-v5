// 部署与回滚的安全约束。
//
// 这几条都不是理论上的担心 —— 每一条对应一次真实事故或一次演练发现。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');

test('rsync --delete 必须排除只存在于服务器的目录', () => {
  /*
    2026-09-03 恢复演练第一分钟发现的：
    deploy.sh 用 rsync --delete 镜像本地到服务器，
    而 backups/ 本地没有、也不在排除清单里 ——
    于是**每次部署都把服务器上的备份全删了**，全程没有任何提示。

    账号拆分前那个 29.7MB 的备份就是这么没的。

    这正是「没演练过的备份只能算大概能恢复」的活例子：
    备份脚本本身没问题，是另一个脚本在背后删它。
  */
  const s = read('deploy/deploy.sh');
  assert.match(s, /--exclude backups/,
    'backups 没排除 —— rsync --delete 会把服务器上的备份删光');
  assert.match(s, /--exclude '\.env\.local'/,
    '.env.local 没排除 —— 会用开发配置覆盖生产配置，所有人突然登不进去');
  assert.match(s, /--exclude \.runtime/,
    '.runtime 没排除 —— 里面有初始密码这类只属于本机的东西');
});

test('部署前必须先给当前版本打快照', () => {
  // 没有快照就没有回滚。而「改坏了只能再改一次修回来」是最容易越修越坏的处境：
  // 你在压力下写代码，同事在那边干不了活。
  const s = read('deploy/deploy.sh');
  assert.match(s, /\[0\/5\] 快照当前版本/, '部署前没有快照步骤');
  assert.match(s, /tail -n \+9 \| xargs -r rm -f/,
    '快照没有清理策略，磁盘迟早被塞满');
});

test('回滚不能把 .env.local 一起退回去', () => {
  /*
    .env.local 是这台机器的配置，不属于任何一个代码版本。
    跟着回滚会把数据库密码、模型开关一起退回旧值 —— 那是另一场事故。
  */
  const s = read('deploy/rollback.sh');
  assert.match(s, /cp \$APP\/\.env\.local \/tmp\/\.env\.keep/, '回滚前没有保住 .env.local');
  assert.match(s, /cp \/tmp\/\.env\.keep \$APP\/\.env\.local/, '回滚后没有放回 .env.local');
});

test('回滚前也要给当前版本打快照', () => {
  // 「回滚之后回不去了」是比原故障更糟的处境
  const s = read('deploy/rollback.sh');
  assert.match(s, /before-rollback-/, '回滚前没有保存当前版本，回滚错了就没退路');
});

test('回滚只动代码，不动数据库', () => {
  /*
    数据库迁移是单向的，回滚它非常危险：
    同事在坏版本期间录进去的数据，回滚迁移就没了。

    好在不需要：新迁移加的都是新列新表，旧代码看不见它们照样能跑。
    「代码退回去、数据留着」是安全的组合。
  */
  const s = read('deploy/rollback.sh');
  assert.doesNotMatch(s, /dropdb|pg_restore/,
    '回滚脚本里出现了数据库操作 —— 那会连同事刚录的数据一起抹掉');
  assert.match(s, /只回滚代码，不回滚数据库/, '没有把这个边界写清楚');
});

test('演练默认恢复到临时库，不碰生产', () => {
  /*
    演练要能随便跑，跑得越多越放心。
    如果演练本身会动生产库，那就没人敢跑，等于没有演练。
  */
  const s = read('deploy/restore-drill.sh');
  assert.match(s, /xinyi_drill/, '演练没有用临时库');
  assert.match(s, /MODE="\$\{1:-drill\}"/, '默认模式不是演练');
  assert.match(s, /确认请完整输入 RESTORE/,
    '真实恢复没有打字确认 —— 覆盖生产库不该是一个回车的事');
});

test('真实恢复前要再备份一次当前状态', () => {
  // 「恢复之后发现恢复错了」如果没有退路，比原故障更糟
  const s = read('deploy/restore-drill.sh');
  assert.match(s, /pre-restore-/, '恢复前没有保存当前状态');
});

test('演练要核对内容，不能只比行数', () => {
  // 一张全是空值的表行数也对得上
  const s = read('deploy/restore-drill.sh');
  assert.match(s, /抽查一条真实数据/, '只比了行数，没有抽查内容');
});
