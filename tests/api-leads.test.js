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

const jsonFetch = async (url, options = {}) => {
  const res = await fetch(url, options);
  const body = await res.json();
  return { res, body };
};

test('lead API preserves current Lead shape for create, update, and follow-up', async () => {
  const { child, baseUrl } = await startServerProcess({
    STATE_STORE_PATH: emptyStatePath('xinyi-leads-api')
  });

  try {
    const empty = await jsonFetch(`${baseUrl}/api/leads`);
    assert.equal(empty.res.status, 200);
    assert.deepEqual(empty.body.data.leads, []);

    const create = await jsonFetch(`${baseUrl}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead: {
          company: '线索 API 测试客户',
          name: '张三',
          mobile: '13800000000',
          wechat: 'wx-api-test',
          position: '负责人',
          industry: '食品',
          targetCertifications: 'ISO 9001',
          registeredAddress: '温州市测试路 1 号'
        }
      })
    });
    assert.equal(create.res.status, 201);
    assert.equal(create.body.ok, true);
    const lead = create.body.data.lead;
    assert.match(lead.id, /^L-/);
    assert.equal(lead.company, '线索 API 测试客户');
    assert.equal(lead.name, '张三');
    assert.equal(lead.status, 'New');
    assert.equal(lead.score, 60);
    assert.equal(lead.potentialValue, 0);
    assert.equal(lead.probability, 20);
    assert.equal(lead.source, '官网');
    assert.equal(lead.intent, 'Medium');
    assert.equal(lead.registeredAddress, '温州市测试路 1 号');
    assert.equal(lead.contacts[0].name, '张三');
    assert.equal(lead.contacts[0].mobile, '13800000000');
    assert.deepEqual(lead.followUpRecords, []);

    const update = await jsonFetch(`${baseUrl}/api/leads/${encodeURIComponent(lead.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead: {
          company: '线索 API 测试客户-已编辑',
          status: 'Pending',
          probability: 45
        }
      })
    });
    assert.equal(update.res.status, 200);
    assert.equal(update.body.data.lead.id, lead.id);
    assert.equal(update.body.data.lead.company, '线索 API 测试客户-已编辑');
    assert.equal(update.body.data.lead.status, 'Pending');
    assert.equal(update.body.data.lead.probability, 45);

    const followUp = await jsonFetch(`${baseUrl}/api/leads/${encodeURIComponent(lead.id)}/follow-ups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        record: {
          type: '微信',
          content: '客户要求明天发资料',
          operator: '销售一号'
        }
      })
    });
    assert.equal(followUp.res.status, 201);
    assert.equal(followUp.body.data.record.type, '微信');
    assert.equal(followUp.body.data.record.content, '客户要求明天发资料');
    assert.match(followUp.body.data.record.id, /^F-/);

    const detail = await jsonFetch(`${baseUrl}/api/leads/${encodeURIComponent(lead.id)}`);
    assert.equal(detail.res.status, 200);
    assert.equal(detail.body.data.lead.company, '线索 API 测试客户-已编辑');
    assert.equal(detail.body.data.lead.followUpRecords.length, 1);
    assert.equal(detail.body.data.lead.followUpRecords[0].operator, '销售一号');

    const state = await jsonFetch(`${baseUrl}/api/state/sync?keys=leads_v8`);
    assert.equal(state.res.status, 200);
    const storedLeads = state.body.data.datasets.leads_v8;
    assert.equal(storedLeads.length, 1);
    assert.equal(storedLeads[0].id, lead.id);
    assert.equal(storedLeads[0].contacts[0].wechat, 'wx-api-test');
    assert.equal(storedLeads[0].followUpRecords[0].content, '客户要求明天发资料');
  } finally {
    await stopServerProcess(child);
  }
});

test('lead API returns 404 for missing lead mutations', async () => {
  const { child, baseUrl } = await startServerProcess({
    STATE_STORE_PATH: emptyStatePath('xinyi-leads-api-missing')
  });

  try {
    const update = await jsonFetch(`${baseUrl}/api/leads/L-NOT-FOUND`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead: { company: '不存在' } })
    });
    assert.equal(update.res.status, 404);
    assert.equal(update.body.ok, false);

    const followUp = await jsonFetch(`${baseUrl}/api/leads/L-NOT-FOUND/follow-ups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record: { content: '不存在' } })
    });
    assert.equal(followUp.res.status, 404);
    assert.equal(followUp.body.ok, false);
  } finally {
    await stopServerProcess(child);
  }
});
