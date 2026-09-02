const backendBase = String(process.env.CUSTOMERS_API_BASE || process.env.DEPLOY_BACKEND_BASE || 'http://127.0.0.1:3001').replace(/\/$/, '');
const apiToken = String(process.env.XINYI_API_AUTH_TOKEN || process.env.API_AUTH_TOKEN || '').trim();
const probePrefix = String(process.env.CUSTOMERS_API_SMOKE_PREFIX || 'SMOKE客户').trim() || 'SMOKE客户';

const headers = {
  'Content-Type': 'application/json',
  ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {})
};

const checks = [];

const record = (name, pass, details = {}) => {
  checks.push({ name, pass: Boolean(pass), ...details });
};

const readJson = async (res) => {
  const text = await res.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
};

const requestJson = async (path, options = {}) => {
  const started = Date.now();
  const res = await fetch(`${backendBase}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {})
    }
  });
  const { text, json } = await readJson(res);
  const elapsedMs = Date.now() - started;
  if (!json || typeof json !== 'object') {
    throw new Error(`invalid json from ${path}: HTTP ${res.status} ${String(text || '').slice(0, 120)}`);
  }
  if (!res.ok || json.ok === false) {
    throw new Error(`request failed ${path}: HTTP ${res.status} ${json.message || String(text || '').slice(0, 120)}`);
  }
  return { res, json, elapsedMs };
};

const run = async () => {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const rand = Math.random().toString(16).slice(2, 8);
  const name = `${probePrefix}-${stamp}-${rand}`;
  const updatedName = `${name}-已验证`;
  const contactPerson = `客户冒烟联系人-${stamp}`;
  const followUpContent = `客户 API smoke 写后读回 ${stamp}`;

  const listBefore = await requestJson('/api/customers');
  const initialCustomers = Array.isArray(listBefore.json?.data?.customers) ? listBefore.json.data.customers : null;
  record('customers-list-before', Array.isArray(initialCustomers), {
    status: listBefore.res.status,
    elapsedMs: listBefore.elapsedMs,
    total: initialCustomers?.length ?? -1
  });

  const create = await requestJson('/api/customers', {
    method: 'POST',
    body: JSON.stringify({
      customer: {
        name,
        contactPerson,
        mobile: '13900000000',
        riskStatus: 'low'
      }
    })
  });
  const customer = create.json?.data?.customer;
  record('customer-create', Boolean(customer?.id && customer.name === name && customer.contactPerson === contactPerson), {
    status: create.res.status,
    elapsedMs: create.elapsedMs,
    customerId: customer?.id || ''
  });
  if (!customer?.id) throw new Error('customer-create did not return customer.id');

  const createdReadback = await requestJson(`/api/customers/${encodeURIComponent(customer.id)}`);
  const createdCustomer = createdReadback.json?.data?.customer;
  record('customer-create-readback', createdCustomer?.id === customer.id && createdCustomer?.name === name, {
    status: createdReadback.res.status,
    elapsedMs: createdReadback.elapsedMs
  });

  const update = await requestJson(`/api/customers/${encodeURIComponent(customer.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ customer: { name: updatedName, riskStatus: 'medium' } })
  });
  const updatedCustomer = update.json?.data?.customer;
  record('customer-update', updatedCustomer?.id === customer.id && updatedCustomer?.name === updatedName && updatedCustomer?.riskStatus === 'medium', {
    status: update.res.status,
    elapsedMs: update.elapsedMs
  });

  const updatedReadback = await requestJson(`/api/customers/${encodeURIComponent(customer.id)}`);
  const verifiedUpdatedCustomer = updatedReadback.json?.data?.customer;
  record('customer-update-readback', verifiedUpdatedCustomer?.id === customer.id && verifiedUpdatedCustomer?.name === updatedName && verifiedUpdatedCustomer?.riskStatus === 'medium', {
    status: updatedReadback.res.status,
    elapsedMs: updatedReadback.elapsedMs
  });

  const followUp = await requestJson(`/api/customers/${encodeURIComponent(customer.id)}/follow-ups`, {
    method: 'POST',
    body: JSON.stringify({
      record: {
        type: '电话',
        content: followUpContent,
        operator: '测试环境冒烟'
      }
    })
  });
  const followUpRecord = followUp.json?.data?.record;
  record('customer-follow-up', Boolean(followUpRecord?.id && followUpRecord.content === followUpContent), {
    status: followUp.res.status,
    elapsedMs: followUp.elapsedMs,
    recordId: followUpRecord?.id || ''
  });

  const followUpReadback = await requestJson(`/api/customers/${encodeURIComponent(customer.id)}`);
  const verifiedFollowUpCustomer = followUpReadback.json?.data?.customer;
  const records = Array.isArray(verifiedFollowUpCustomer?.followUpRecords) ? verifiedFollowUpCustomer.followUpRecords : [];
  record('customer-follow-up-readback', records.some((item) => item.id === followUpRecord?.id && item.content === followUpContent), {
    status: followUpReadback.res.status,
    elapsedMs: followUpReadback.elapsedMs,
    followUpCount: records.length
  });

  const stateReadback = await requestJson('/api/state/sync?keys=customers_v8');
  const stateCustomers = stateReadback.json?.data?.datasets?.customers_v8;
  record('state-customers-readback', Array.isArray(stateCustomers) && stateCustomers.some((item) => item.id === customer.id && item.name === updatedName), {
    status: stateReadback.res.status,
    elapsedMs: stateReadback.elapsedMs,
    total: Array.isArray(stateCustomers) ? stateCustomers.length : -1
  });

  checks.forEach((check) => {
    const flag = check.pass ? 'PASS' : 'FAIL';
    const meta = Object.entries(check)
      .filter(([key]) => !['name', 'pass'].includes(key))
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(' | ');
    console.log(`${flag} | ${check.name}${meta ? ` | ${meta}` : ''}`);
  });

  const fail = checks.filter((check) => !check.pass).length;
  console.log(`SUMMARY | total=${checks.length} pass=${checks.length - fail} fail=${fail} customerId=${customer.id} generatedAt=${new Date().toISOString()}`);
  if (fail > 0) process.exit(1);
};

run().catch((error) => {
  console.error(`[customers-api-smoke] ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
