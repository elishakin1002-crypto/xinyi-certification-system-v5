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

test('contract API preserves current Contract shape for create, update, and attachment append', async () => {
  const { child, baseUrl } = await startServerProcess({
    STATE_STORE_PATH: emptyStatePath('xinyi-contracts-api')
  });

  try {
    const empty = await jsonFetch(`${baseUrl}/api/contracts`);
    assert.equal(empty.res.status, 200);
    assert.deepEqual(empty.body.data.contracts, []);

    const create = await jsonFetch(`${baseUrl}/api/contracts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contract: {
          title: 'ISO 9001 认证服务合同',
          customerId: 'C-API-1',
          customerName: '合同 API 测试公司',
          amount: 98000,
          signDate: '2026-05-09',
          serviceLine: 'ISO 9001',
          contractNo: 'HT-API-001',
          contactPerson: '王五',
          paymentMethod: '分期付款',
          remarks: '合同 API 测试备注',
          receivables: [
            { id: 'R-API-1', node: '首款', amount: 49000, dueDate: '2026-05-20', status: 'unpaid' }
          ],
          attachments: [
            { id: 'ATT-API-1', name: '合同扫描件.pdf', size: '12 KB', type: 'application/pdf', uploadDate: '2026-05-09' }
          ],
          serviceItems: [{ name: 'ISO 9001', category: '体系认证', deliveryMode: 'Self' }]
        }
      })
    });
    assert.equal(create.res.status, 201);
    assert.equal(create.body.ok, true);
    const contract = create.body.data.contract;
    assert.match(contract.id, /^CT-/);
    assert.equal(contract.title, 'ISO 9001 认证服务合同');
    assert.equal(contract.customerId, 'C-API-1');
    assert.equal(contract.customerName, '合同 API 测试公司');
    assert.equal(contract.amount, 98000);
    assert.equal(contract.signDate, '2026-05-09');
    assert.equal(contract.status, 'Active');
    assert.equal(contract.serviceLine, 'ISO 9001');
    assert.equal(contract.riskLevel, 'Low');
    assert.equal(contract.archiveStatus, 'active');
    assert.equal(contract.contractNo, 'HT-API-001');
    assert.equal(contract.contactPerson, '王五');
    assert.equal(contract.paymentMethod, '分期付款');
    assert.equal(contract.remarks, '合同 API 测试备注');
    assert.equal(contract.receivables[0].node, '首款');
    assert.equal(contract.receivables[0].status, 'unpaid');
    assert.equal(contract.attachments[0].name, '合同扫描件.pdf');
    assert.equal(contract.serviceItems[0].name, 'ISO 9001');

    const update = await jsonFetch(`${baseUrl}/api/contracts/${encodeURIComponent(contract.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contract: {
          title: 'ISO 9001 认证服务合同-已编辑',
          riskLevel: 'Medium',
          receivables: [
            { id: 'R-API-1', node: '首款', amount: 49000, dueDate: '2026-05-20', status: 'paid' }
          ]
        }
      })
    });
    assert.equal(update.res.status, 200);
    assert.equal(update.body.data.contract.id, contract.id);
    assert.equal(update.body.data.contract.title, 'ISO 9001 认证服务合同-已编辑');
    assert.equal(update.body.data.contract.riskLevel, 'Medium');
    assert.equal(update.body.data.contract.receivables[0].status, 'paid');

    const attachment = await jsonFetch(`${baseUrl}/api/contracts/${encodeURIComponent(contract.id)}/attachments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attachment: {
          name: '补充协议.pdf',
          size: '8 KB',
          type: 'application/pdf',
          uploadDate: '2026-05-10'
        }
      })
    });
    assert.equal(attachment.res.status, 201);
    assert.match(attachment.body.data.attachment.id, /^ATT-/);
    assert.equal(attachment.body.data.attachment.name, '补充协议.pdf');
    assert.equal(attachment.body.data.contract.attachments.length, 2);

    const detail = await jsonFetch(`${baseUrl}/api/contracts/${encodeURIComponent(contract.id)}`);
    assert.equal(detail.res.status, 200);
    assert.equal(detail.body.data.contract.title, 'ISO 9001 认证服务合同-已编辑');
    assert.equal(detail.body.data.contract.attachments.length, 2);

    const state = await jsonFetch(`${baseUrl}/api/state/sync?keys=contracts_v8`);
    assert.equal(state.res.status, 200);
    const storedContracts = state.body.data.datasets.contracts_v8;
    assert.equal(storedContracts.length, 1);
    assert.equal(storedContracts[0].id, contract.id);
    assert.equal(storedContracts[0].receivables[0].status, 'paid');
    assert.equal(storedContracts[0].attachments[1].name, '补充协议.pdf');
  } finally {
    await stopServerProcess(child);
  }
});

test('contract API returns 404 for missing contract mutations', async () => {
  const { child, baseUrl } = await startServerProcess({
    STATE_STORE_PATH: emptyStatePath('xinyi-contracts-api-missing')
  });

  try {
    const update = await jsonFetch(`${baseUrl}/api/contracts/CT-NOT-FOUND`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contract: { title: '不存在' } })
    });
    assert.equal(update.res.status, 404);
    assert.equal(update.body.ok, false);

    const attachment = await jsonFetch(`${baseUrl}/api/contracts/CT-NOT-FOUND/attachments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attachment: { name: '不存在.pdf' } })
    });
    assert.equal(attachment.res.status, 404);
    assert.equal(attachment.body.ok, false);
  } finally {
    await stopServerProcess(child);
  }
});

test('contract transaction API writes linked contract datasets together', async () => {
  const { child, baseUrl } = await startServerProcess({
    STATE_STORE_PATH: emptyStatePath('xinyi-contracts-transaction-api')
  });

  try {
    const contract = {
      id: 'CT-TXN-1',
      title: '合同事务测试',
      customerId: 'C-TXN-1',
      customerName: '合同事务客户',
      amount: 50000,
      signDate: '2026-05-10',
      status: 'Active',
      serviceLine: 'ISO 14001',
      riskLevel: 'Low',
      archiveStatus: 'active',
      receivables: [],
      attachments: []
    };
    const customer = {
      id: 'C-TXN-1',
      name: '合同事务客户',
      contactPerson: '事务联系人',
      totalValue: 0,
      riskStatus: 'low',
      activeContracts: 0
    };
    const project = {
      id: 'P-TXN-1',
      name: '合同事务客户 ISO 14001',
      contractRef: contract.id,
      customerId: customer.id,
      status: 'Active',
      progress: 0,
      tasks: []
    };
    const lead = {
      id: 'L-TXN-1',
      company: '合同事务客户',
      name: '事务联系人',
      status: 'Converted'
    };

    const commit = await jsonFetch(`${baseUrl}/api/contracts/transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contractId: contract.id,
        datasets: {
          contracts_v8: [contract],
          customers_v8: [customer],
          projects_v8: [project],
          leads_v8: [lead],
          unsupported_v8: [{ id: 'ignored' }]
        }
      })
    });
    assert.equal(commit.res.status, 200);
    assert.equal(commit.body.ok, true);
    assert.equal(commit.body.data.written, 4);
    assert.deepEqual(commit.body.data.keys.sort(), ['contracts_v8', 'customers_v8', 'leads_v8', 'projects_v8'].sort());
    assert.equal(commit.body.data.contract.id, contract.id);

    const state = await jsonFetch(`${baseUrl}/api/state/sync?keys=contracts_v8,customers_v8,projects_v8,leads_v8,unsupported_v8`);
    assert.equal(state.res.status, 200);
    assert.equal(state.body.data.datasets.contracts_v8[0].id, contract.id);
    assert.equal(state.body.data.datasets.customers_v8[0].id, customer.id);
    assert.equal(state.body.data.datasets.projects_v8[0].contractRef, contract.id);
    assert.equal(state.body.data.datasets.leads_v8[0].status, 'Converted');
    assert.equal(state.body.data.datasets.unsupported_v8, undefined);
  } finally {
    await stopServerProcess(child);
  }
});

test('contract transaction API rejects missing contracts dataset or mismatched contractId', async () => {
  const { child, baseUrl } = await startServerProcess({
    STATE_STORE_PATH: emptyStatePath('xinyi-contracts-transaction-api-invalid')
  });

  try {
    const missingContracts = await jsonFetch(`${baseUrl}/api/contracts/transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datasets: { customers_v8: [] } })
    });
    assert.equal(missingContracts.res.status, 400);
    assert.equal(missingContracts.body.ok, false);

    const mismatchedContract = await jsonFetch(`${baseUrl}/api/contracts/transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contractId: 'CT-MISSING',
        datasets: {
          contracts_v8: [{
            id: 'CT-OTHER',
            title: '其他合同',
            customerName: '其他客户',
            amount: 1,
            signDate: '2026-05-10',
            status: 'Active',
            serviceLine: '测试',
            riskLevel: 'Low',
            archiveStatus: 'active',
            receivables: [],
            attachments: []
          }]
        }
      })
    });
    assert.equal(mismatchedContract.res.status, 400);
    assert.equal(mismatchedContract.body.ok, false);
  } finally {
    await stopServerProcess(child);
  }
});
