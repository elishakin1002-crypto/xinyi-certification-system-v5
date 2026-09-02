const backendBase = String(process.env.LEADS_API_BASE || process.env.DEPLOY_BACKEND_BASE || 'http://127.0.0.1:3001').replace(/\/$/, '');
const apiToken = String(process.env.XINYI_API_AUTH_TOKEN || process.env.API_AUTH_TOKEN || '').trim();
const probePrefix = String(process.env.LEADS_API_SMOKE_PREFIX || 'SMOKE线索').trim() || 'SMOKE线索';

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
  const company = `${probePrefix}-${stamp}-${rand}`;
  const updatedCompany = `${company}-已验证`;
  const followUpContent = `线索 API smoke 写后读回 ${stamp}`;

  const listBefore = await requestJson('/api/leads');
  const initialLeads = Array.isArray(listBefore.json?.data?.leads) ? listBefore.json.data.leads : null;
  record('leads-list-before', Array.isArray(initialLeads), {
    status: listBefore.res.status,
    elapsedMs: listBefore.elapsedMs,
    total: initialLeads?.length ?? -1
  });

  const createPayload = {
    lead: {
      company,
      name: '线索冒烟测试',
      mobile: '13800000000',
      source: '测试环境冒烟',
      intent: 'Medium',
      targetCertifications: 'ISO 9001'
    }
  };
  const create = await requestJson('/api/leads', {
    method: 'POST',
    body: JSON.stringify(createPayload)
  });
  const lead = create.json?.data?.lead;
  record('lead-create', Boolean(lead?.id && lead.company === company), {
    status: create.res.status,
    elapsedMs: create.elapsedMs,
    leadId: lead?.id || ''
  });
  if (!lead?.id) throw new Error('lead-create did not return lead.id');

  const createdReadback = await requestJson(`/api/leads/${encodeURIComponent(lead.id)}`);
  const createdLead = createdReadback.json?.data?.lead;
  record('lead-create-readback', createdLead?.id === lead.id && createdLead?.company === company, {
    status: createdReadback.res.status,
    elapsedMs: createdReadback.elapsedMs
  });

  const update = await requestJson(`/api/leads/${encodeURIComponent(lead.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ lead: { company: updatedCompany, probability: 55 } })
  });
  const updatedLead = update.json?.data?.lead;
  record('lead-update', updatedLead?.id === lead.id && updatedLead?.company === updatedCompany && Number(updatedLead?.probability) === 55, {
    status: update.res.status,
    elapsedMs: update.elapsedMs
  });

  const updatedReadback = await requestJson(`/api/leads/${encodeURIComponent(lead.id)}`);
  const verifiedUpdatedLead = updatedReadback.json?.data?.lead;
  record('lead-update-readback', verifiedUpdatedLead?.id === lead.id && verifiedUpdatedLead?.company === updatedCompany && Number(verifiedUpdatedLead?.probability) === 55, {
    status: updatedReadback.res.status,
    elapsedMs: updatedReadback.elapsedMs
  });

  const followUp = await requestJson(`/api/leads/${encodeURIComponent(lead.id)}/follow-ups`, {
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
  record('lead-follow-up', Boolean(followUpRecord?.id && followUpRecord.content === followUpContent), {
    status: followUp.res.status,
    elapsedMs: followUp.elapsedMs,
    recordId: followUpRecord?.id || ''
  });

  const followUpReadback = await requestJson(`/api/leads/${encodeURIComponent(lead.id)}`);
  const verifiedFollowUpLead = followUpReadback.json?.data?.lead;
  const records = Array.isArray(verifiedFollowUpLead?.followUpRecords) ? verifiedFollowUpLead.followUpRecords : [];
  record('lead-follow-up-readback', records.some((item) => item.id === followUpRecord?.id && item.content === followUpContent), {
    status: followUpReadback.res.status,
    elapsedMs: followUpReadback.elapsedMs,
    followUpCount: records.length
  });

  const stateReadback = await requestJson('/api/state/sync?keys=leads_v8');
  const stateLeads = stateReadback.json?.data?.datasets?.leads_v8;
  record('state-leads-readback', Array.isArray(stateLeads) && stateLeads.some((item) => item.id === lead.id && item.company === updatedCompany), {
    status: stateReadback.res.status,
    elapsedMs: stateReadback.elapsedMs,
    total: Array.isArray(stateLeads) ? stateLeads.length : -1
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
  console.log(`SUMMARY | total=${checks.length} pass=${checks.length - fail} fail=${fail} leadId=${lead.id} generatedAt=${new Date().toISOString()}`);
  if (fail > 0) process.exit(1);
};

run().catch((error) => {
  console.error(`[leads-api-smoke] ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
