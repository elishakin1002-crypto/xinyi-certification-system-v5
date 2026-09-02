const backendBase = String(process.env.CONTRACTS_API_BASE || process.env.DEPLOY_BACKEND_BASE || 'http://127.0.0.1:3001').replace(/\/$/, '');
const apiToken = String(process.env.XINYI_API_AUTH_TOKEN || process.env.API_AUTH_TOKEN || '').trim();
const probePrefix = String(process.env.CONTRACTS_API_SMOKE_PREFIX || 'SMOKE合同').trim() || 'SMOKE合同';

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
  const title = `${probePrefix}-${stamp}-${rand}`;
  const updatedTitle = `${title}-已验证`;
  const customerName = `合同冒烟客户-${stamp}`;
  const attachmentName = `合同冒烟附件-${stamp}.pdf`;

  const listBefore = await requestJson('/api/contracts');
  const initialContracts = Array.isArray(listBefore.json?.data?.contracts) ? listBefore.json.data.contracts : null;
  record('contracts-list-before', Array.isArray(initialContracts), {
    status: listBefore.res.status,
    elapsedMs: listBefore.elapsedMs,
    total: initialContracts?.length ?? -1
  });

  const create = await requestJson('/api/contracts', {
    method: 'POST',
    body: JSON.stringify({
      contract: {
        title,
        customerName,
        amount: 98000,
        signDate: new Date().toISOString().slice(0, 10),
        serviceLine: 'ISO 9001',
        contractNo: `SMOKE-${stamp}-${rand}`,
        receivables: [
          { node: '首款', amount: 49000, dueDate: new Date().toISOString().slice(0, 10), status: 'unpaid' }
        ]
      }
    })
  });
  const contract = create.json?.data?.contract;
  record('contract-create', Boolean(contract?.id && contract.title === title && contract.customerName === customerName), {
    status: create.res.status,
    elapsedMs: create.elapsedMs,
    contractId: contract?.id || ''
  });
  if (!contract?.id) throw new Error('contract-create did not return contract.id');

  const createdReadback = await requestJson(`/api/contracts/${encodeURIComponent(contract.id)}`);
  const createdContract = createdReadback.json?.data?.contract;
  record('contract-create-readback', createdContract?.id === contract.id && createdContract?.title === title, {
    status: createdReadback.res.status,
    elapsedMs: createdReadback.elapsedMs
  });

  const update = await requestJson(`/api/contracts/${encodeURIComponent(contract.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      contract: {
        title: updatedTitle,
        riskLevel: 'Medium',
        receivables: [
          { ...(Array.isArray(contract.receivables) ? contract.receivables[0] : {}), status: 'paid' }
        ]
      }
    })
  });
  const updatedContract = update.json?.data?.contract;
  record('contract-update', updatedContract?.id === contract.id && updatedContract?.title === updatedTitle && updatedContract?.riskLevel === 'Medium', {
    status: update.res.status,
    elapsedMs: update.elapsedMs
  });

  const updatedReadback = await requestJson(`/api/contracts/${encodeURIComponent(contract.id)}`);
  const verifiedUpdatedContract = updatedReadback.json?.data?.contract;
  record('contract-update-readback', verifiedUpdatedContract?.id === contract.id && verifiedUpdatedContract?.title === updatedTitle && verifiedUpdatedContract?.riskLevel === 'Medium', {
    status: updatedReadback.res.status,
    elapsedMs: updatedReadback.elapsedMs
  });

  const attachment = await requestJson(`/api/contracts/${encodeURIComponent(contract.id)}/attachments`, {
    method: 'POST',
    body: JSON.stringify({
      attachment: {
        name: attachmentName,
        size: '8 KB',
        type: 'application/pdf',
        uploadDate: new Date().toISOString().slice(0, 10)
      }
    })
  });
  const attachmentRecord = attachment.json?.data?.attachment;
  record('contract-attachment', Boolean(attachmentRecord?.id && attachmentRecord.name === attachmentName), {
    status: attachment.res.status,
    elapsedMs: attachment.elapsedMs,
    attachmentId: attachmentRecord?.id || ''
  });

  const attachmentReadback = await requestJson(`/api/contracts/${encodeURIComponent(contract.id)}`);
  const verifiedAttachmentContract = attachmentReadback.json?.data?.contract;
  const attachments = Array.isArray(verifiedAttachmentContract?.attachments) ? verifiedAttachmentContract.attachments : [];
  record('contract-attachment-readback', attachments.some((item) => item.id === attachmentRecord?.id && item.name === attachmentName), {
    status: attachmentReadback.res.status,
    elapsedMs: attachmentReadback.elapsedMs,
    attachmentCount: attachments.length
  });

  const stateReadback = await requestJson('/api/state/sync?keys=contracts_v8');
  const stateContracts = stateReadback.json?.data?.datasets?.contracts_v8;
  record('state-contracts-readback', Array.isArray(stateContracts) && stateContracts.some((item) => item.id === contract.id && item.title === updatedTitle), {
    status: stateReadback.res.status,
    elapsedMs: stateReadback.elapsedMs,
    total: Array.isArray(stateContracts) ? stateContracts.length : -1
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
  console.log(`SUMMARY | total=${checks.length} pass=${checks.length - fail} fail=${fail} contractId=${contract.id} generatedAt=${new Date().toISOString()}`);
  if (fail > 0) process.exit(1);
};

run().catch((error) => {
  console.error(`[contracts-api-smoke] ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
