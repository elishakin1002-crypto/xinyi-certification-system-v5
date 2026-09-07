// 项目分三类，分类决定「要不要有客户」。
//
// 2026-09-07 金恩来：「建立项目时一定要选择归属客户，那逻辑不就变成
// 要先建立客户再建立项目吗？」以及「政府要我们配合通知 2000 家企业
// 营业执照要年检，这个任务就没有办法选择归属客户」。
//
// 后一条更要紧：**这类活按原规则根本进不了系统**。
// 进不了系统不是少一条记录，是这件事的工时、进度、谁在做
// 全部回到微信群和个人脑子里 —— 而这恰恰是最该沉淀的那类事：
// 政府交办的事做好了，就是下一批线索。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');

test('项目有三类，公共事务不要客户', () => {
  assert.match(read('types.ts'), /export type ProjectCategory = 'Delivery' \| 'FollowUp' \| 'Public';/,
    '没有「公共事务」这一类');
  assert.match(read('types.ts'), /export type ProjectMode = 'followup' \| 'delivery' \| 'public';/,
    'ProjectMode 没跟着加');

  const caps = read('src/utils/projectCapabilities.ts');
  assert.match(caps, /if \(project\.projectCategory === 'Public'\) return 'public';/,
    '公共事务没有映射到自己的模式');
  /*
    公共事务没有合同也没有客户 —— 服务项和回款这两块留着，
    只会让人对着空表单发愣。
  */
  assert.match(caps, /showFinancePanel: !isIntelOrigin && !isPublicProject/, '公共事务还显示回款面板');
  assert.match(caps, /showServicePanel: !isIntelOrigin && !isPublicProject/, '公共事务还显示服务项面板');
});

test('客户必填与否，由类别决定', () => {
  /*
    原来一律必填，逻辑上是倒的：变成「必须先建客户，才能建项目」，
    而现实里往往是先有事、后有客户。
  */
  const src = read('pages/Projects.tsx');
  assert.match(src, /if \(formData\.projectCategory === 'Delivery' && !customerId\)/,
    '还是一律必填');
  assert.match(src, /把类别改成「跟进项目」/,
    '拒绝时没告诉人该怎么办 —— 只说不行等于把人堵死');

  // 公共事务连这一栏都不显示：摆一个填不了的必填框只会让人卡住
  assert.match(src, /\{formData\.projectCategory !== 'Public' && \(/,
    '公共事务还显示归属客户');
  assert.match(src, /required=\{formData\.projectCategory === 'Delivery'\}/,
    '跟进项目的客户还是必填');
});

test('三类都要在界面上说清楚各自什么时候用', () => {
  /*
    多一个选项就多一次「我该选哪个」的犹豫。
    分类的名字解决不了这个问题，得直说什么时候用哪个。
  */
  const src = read('pages/Projects.tsx');
  assert.match(src, /公共事务/, '界面上没有第三个选项');
  assert.match(src, /政府交办、行业活动、内部建设这类不属于任何客户的活/,
    '没说清公共事务什么时候用');
  assert.match(src, /客户还没谈成时用这个/, '没说清跟进项目什么时候用');
});
