const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { startServerProcess, stopServerProcess } = require('./helpers/serverProcess');

const emptyStatePath = (name) => {
  const file = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify({ updated_at: new Date().toISOString(), datasets: {} }, null, 2));
  return file;
};

test('website lead intake is disabled by default', async () => {
  const { child, baseUrl } = await startServerProcess({
    STATE_STORE_PATH: emptyStatePath('xinyi-public-leads-disabled'),
    XINYI_PUBLIC_LEAD_ENABLED: 'false'
  });

  try {
    const res = await fetch(`${baseUrl}/api/public/website-leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: '测试公司', contactName: '张三' })
    });
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.equal(body.ok, false);
  } finally {
    await stopServerProcess(child);
  }
});

test('website lead intake creates a lead and appends duplicate submissions as follow-up', async () => {
  const publicToken = `public-${Date.now()}`;
  const company = `官网测试客户-${Date.now()}`;
  const { child, baseUrl } = await startServerProcess({
    STATE_STORE_PATH: emptyStatePath('xinyi-public-leads'),
    XINYI_PUBLIC_LEAD_ENABLED: 'true',
    XINYI_PUBLIC_LEAD_TOKEN: publicToken
  });

  try {
    const missingToken = await fetch(`${baseUrl}/api/public/website-leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company, contactName: '张三' })
    });
    assert.equal(missingToken.status, 403);

    const create = await fetch(`${baseUrl}/api/public/website-leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-xinyi-public-lead-token': publicToken
      },
      body: JSON.stringify({
        company,
        contactName: '张三',
        mobile: '13800000000',
        wechat: 'wx-test',
        position: '负责人',
        industry: '食品',
        targetCertifications: 'ISO 9001',
        message: '想咨询认证办理',
        pageUrl: 'https://www.xinyi-iso.com/contact'
      })
    });
    const createBody = await create.json();
    assert.equal(create.status, 201);
    assert.equal(createBody.ok, true);
    assert.equal(createBody.data.created, true);
    assert.ok(createBody.data.leadId);

    const duplicate = await fetch(`${baseUrl}/api/public/website-leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-xinyi-public-lead-token': publicToken
      },
      body: JSON.stringify({
        company,
        contactName: '张三',
        mobile: '13800000000',
        message: '第二次留言',
        pageUrl: 'https://www.xinyi-iso.com/apply'
      })
    });
    const duplicateBody = await duplicate.json();
    assert.equal(duplicate.status, 200);
    assert.equal(duplicateBody.data.created, false);
    assert.equal(duplicateBody.data.leadId, createBody.data.leadId);

    const state = await fetch(`${baseUrl}/api/state/sync?keys=leads_v8`);
    const stateBody = await state.json();
    assert.equal(state.status, 200);
    const leads = stateBody.data.datasets.leads_v8;
    assert.equal(leads.length, 1);
    assert.equal(leads[0].company, company);
    assert.equal(leads[0].name, '张三');
    assert.equal(leads[0].mobile, '13800000000');
    assert.equal(leads[0].source, '官网表单');
    assert.equal(leads[0].targetCertifications, 'ISO 9001');
    assert.equal(leads[0].contacts[0].wechat, 'wx-test');
    assert.equal(leads[0].followUpRecords.length, 2);
    assert.match(leads[0].followUpRecords[0].content, /想咨询认证办理/);
    assert.match(leads[0].followUpRecords[1].content, /第二次留言/);
  } finally {
    await stopServerProcess(child);
  }
});
