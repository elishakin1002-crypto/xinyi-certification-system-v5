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

test('customer API preserves current Customer shape for create, update, and follow-up', async () => {
  const { child, baseUrl } = await startServerProcess({
    STATE_STORE_PATH: emptyStatePath('xinyi-customers-api')
  });

  try {
    const empty = await jsonFetch(`${baseUrl}/api/customers`);
    assert.equal(empty.res.status, 200);
    assert.deepEqual(empty.body.data.customers, []);

    const create = await jsonFetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: {
          name: '客户 API 测试公司',
          contactPerson: '李四',
          mobile: '13900000000',
          industry: '包装',
          unifiedSocialCreditCode: '91330000TEST',
          registeredAddress: '温州市客户路 2 号',
          contacts: [{ id: 'cp-api-1', name: '李四', mobile: '13900000000', isPrimary: true }]
        }
      })
    });
    assert.equal(create.res.status, 201);
    assert.equal(create.body.ok, true);
    const customer = create.body.data.customer;
    assert.match(customer.id, /^C-/);
    assert.equal(customer.name, '客户 API 测试公司');
    assert.equal(customer.contactPerson, '李四');
    assert.equal(customer.mobile, '13900000000');
    assert.equal(customer.industry, '包装');
    assert.equal(customer.unifiedSocialCreditCode, '91330000TEST');
    assert.equal(customer.registeredAddress, '温州市客户路 2 号');
    assert.equal(customer.totalValue, 0);
    assert.equal(customer.riskStatus, 'low');
    assert.equal(customer.activeContracts, 0);
    assert.equal(customer.contacts[0].name, '李四');
    assert.deepEqual(customer.followUpRecords, []);

    const update = await jsonFetch(`${baseUrl}/api/customers/${encodeURIComponent(customer.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: {
          name: '客户 API 测试公司-已编辑',
          riskStatus: 'medium',
          totalValue: 88000
        }
      })
    });
    assert.equal(update.res.status, 200);
    assert.equal(update.body.data.customer.id, customer.id);
    assert.equal(update.body.data.customer.name, '客户 API 测试公司-已编辑');
    assert.equal(update.body.data.customer.riskStatus, 'medium');
    assert.equal(update.body.data.customer.totalValue, 88000);

    const followUp = await jsonFetch(`${baseUrl}/api/customers/${encodeURIComponent(customer.id)}/follow-ups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        record: {
          type: '电话',
          content: '客户确认下周复盘',
          operator: '客服一号'
        }
      })
    });
    assert.equal(followUp.res.status, 201);
    assert.equal(followUp.body.data.record.type, '电话');
    assert.equal(followUp.body.data.record.content, '客户确认下周复盘');
    assert.match(followUp.body.data.record.id, /^F-/);

    const detail = await jsonFetch(`${baseUrl}/api/customers/${encodeURIComponent(customer.id)}`);
    assert.equal(detail.res.status, 200);
    assert.equal(detail.body.data.customer.name, '客户 API 测试公司-已编辑');
    assert.equal(detail.body.data.customer.followUpRecords.length, 1);
    assert.equal(detail.body.data.customer.followUpRecords[0].operator, '客服一号');

    const state = await jsonFetch(`${baseUrl}/api/state/sync?keys=customers_v8`);
    assert.equal(state.res.status, 200);
    const storedCustomers = state.body.data.datasets.customers_v8;
    assert.equal(storedCustomers.length, 1);
    assert.equal(storedCustomers[0].id, customer.id);
    assert.equal(storedCustomers[0].contacts[0].mobile, '13900000000');
    assert.equal(storedCustomers[0].followUpRecords[0].content, '客户确认下周复盘');
  } finally {
    await stopServerProcess(child);
  }
});

test('customer API returns 404 for missing customer mutations', async () => {
  const { child, baseUrl } = await startServerProcess({
    STATE_STORE_PATH: emptyStatePath('xinyi-customers-api-missing')
  });

  try {
    const update = await jsonFetch(`${baseUrl}/api/customers/C-NOT-FOUND`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer: { name: '不存在' } })
    });
    assert.equal(update.res.status, 404);
    assert.equal(update.body.ok, false);

    const followUp = await jsonFetch(`${baseUrl}/api/customers/C-NOT-FOUND/follow-ups`, {
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
