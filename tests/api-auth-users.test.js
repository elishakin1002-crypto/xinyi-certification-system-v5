const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { startServerProcess, stopServerProcess } = require('./helpers/serverProcess');

const cookieValue = (setCookie, name) => {
  const raw = Array.isArray(setCookie) ? setCookie[0] : String(setCookie || '');
  const part = raw.split(';')[0] || '';
  const [cookieName, value] = part.split('=');
  return cookieName === name ? value : '';
};

const login = async (baseUrl, account, password) => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password })
  });
  const body = await res.json();
  const session = cookieValue(res.headers.get('set-cookie') || '', 'xinyi_session');
  return { res, body, session };
};

test('auth user management: admin can create, update, list, and reset employee password', async () => {
  const adminPassword = `Admin-${Date.now()}!`;
  const employeeEmail = `employee-${Date.now()}@example.test`;
  const { child, baseUrl } = await startServerProcess({
    AUTH_STORE_PATH: path.join(os.tmpdir(), `xinyi-auth-users-${Date.now()}-${Math.random().toString(16).slice(2)}.json`),
    XINYI_AUTH_SEED_ADMIN_EMAIL: 'admin@example.test',
    XINYI_AUTH_SEED_ADMIN_PASSWORD: adminPassword,
    XINYI_SESSION_COOKIE_SECURE: 'false'
  });

  try {
    const adminLogin = await login(baseUrl, 'admin@example.test', adminPassword);
    assert.equal(adminLogin.res.status, 200);
    assert.ok(adminLogin.session);
    const adminId = adminLogin.body.data.user.id;

    const selfDisable = await fetch(`${baseUrl}/api/auth/users/${adminId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `xinyi_session=${adminLogin.session}`
      },
      body: JSON.stringify({ status: 'disabled' })
    });
    assert.equal(selfDisable.status, 400);

    const selfDemote = await fetch(`${baseUrl}/api/auth/users/${adminId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `xinyi_session=${adminLogin.session}`
      },
      body: JSON.stringify({ roles: ['MANAGER'], activeRole: 'MANAGER' })
    });
    assert.equal(selfDemote.status, 400);

    const create = await fetch(`${baseUrl}/api/auth/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `xinyi_session=${adminLogin.session}`
      },
      body: JSON.stringify({
        email: employeeEmail,
        username: 'finance-user',
        name: '测试财务',
        password: 'initial-pass',
        roles: ['FINANCE'],
        activeRole: 'FINANCE',
        positionTags: ['财务'],
        status: 'active'
      })
    });
    const createBody = await create.json();
    assert.equal(create.status, 201);
    assert.equal(createBody.ok, true);
    assert.equal(createBody.data.user.email, employeeEmail);
    assert.equal(createBody.data.user.passwordHash, undefined);
    assert.equal(createBody.data.user.roles[0], 'FINANCE');
    assert.equal(createBody.data.user.mustChangePassword, true);
    const employeeId = createBody.data.user.id;

    const update = await fetch(`${baseUrl}/api/auth/users/${employeeId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `xinyi_session=${adminLogin.session}`
      },
      body: JSON.stringify({ name: '测试财务主管', positionTags: ['财务', '回款'] })
    });
    const updateBody = await update.json();
    assert.equal(update.status, 200);
    assert.equal(updateBody.data.user.name, '测试财务主管');
    assert.deepEqual(updateBody.data.user.positionTags, ['财务', '回款']);

    const list = await fetch(`${baseUrl}/api/auth/users`, {
      headers: { Cookie: `xinyi_session=${adminLogin.session}` }
    });
    const listBody = await list.json();
    assert.equal(list.status, 200);
    assert.ok(listBody.data.users.some((user) => user.id === employeeId));
    assert.equal(listBody.data.users.some((user) => user.passwordHash), false);

    const employeeLogin = await login(baseUrl, employeeEmail, 'initial-pass');
    assert.equal(employeeLogin.res.status, 200);
    assert.ok(employeeLogin.session);
    assert.equal(employeeLogin.body.data.user.mustChangePassword, true);

    const forbidden = await fetch(`${baseUrl}/api/auth/users`, {
      headers: { Cookie: `xinyi_session=${employeeLogin.session}` }
    });
    const forbiddenBody = await forbidden.json();
    assert.equal(forbidden.status, 403);
    assert.equal(forbiddenBody.code, 1003);

    const forbiddenAudit = await fetch(`${baseUrl}/api/auth/audit-logs`, {
      headers: { Cookie: `xinyi_session=${employeeLogin.session}` }
    });
    const forbiddenAuditBody = await forbiddenAudit.json();
    assert.equal(forbiddenAudit.status, 403);
    assert.equal(forbiddenAuditBody.data.requiredAction, 'AUTH_AUDIT_VIEW');

    const forbiddenCreate = await fetch(`${baseUrl}/api/auth/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `xinyi_session=${employeeLogin.session}`
      },
      body: JSON.stringify({
        email: `blocked-${Date.now()}@example.test`,
        name: '无权限创建',
        password: 'blocked-pass',
        roles: ['CONSULTANT']
      })
    });
    const forbiddenCreateBody = await forbiddenCreate.json();
    assert.equal(forbiddenCreate.status, 403);
    assert.equal(forbiddenCreateBody.data.requiredAction, 'EMPLOYEE_CREATE');

    const forbiddenUpdate = await fetch(`${baseUrl}/api/auth/users/${employeeId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `xinyi_session=${employeeLogin.session}`
      },
      body: JSON.stringify({ name: '无权限更新' })
    });
    const forbiddenUpdateBody = await forbiddenUpdate.json();
    assert.equal(forbiddenUpdate.status, 403);
    assert.equal(forbiddenUpdateBody.data.requiredAction, 'EMPLOYEE_UPDATE');

    const forbiddenReset = await fetch(`${baseUrl}/api/auth/users/${employeeId}/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `xinyi_session=${employeeLogin.session}`
      },
      body: JSON.stringify({ password: 'blocked-pass-2' })
    });
    const forbiddenResetBody = await forbiddenReset.json();
    assert.equal(forbiddenReset.status, 403);
    assert.equal(forbiddenResetBody.data.requiredAction, 'EMPLOYEE_RESET_PASSWORD');

    const disable = await fetch(`${baseUrl}/api/auth/users/${employeeId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `xinyi_session=${adminLogin.session}`
      },
      body: JSON.stringify({ status: 'disabled' })
    });
    const disableBody = await disable.json();
    assert.equal(disable.status, 200);
    assert.equal(disableBody.data.user.status, 'disabled');

    const disabledSession = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: `xinyi_session=${employeeLogin.session}` }
    });
    assert.equal(disabledSession.status, 401);

    const disabledLogin = await login(baseUrl, employeeEmail, 'initial-pass');
    assert.equal(disabledLogin.res.status, 403);

    const reenable = await fetch(`${baseUrl}/api/auth/users/${employeeId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `xinyi_session=${adminLogin.session}`
      },
      body: JSON.stringify({ status: 'active' })
    });
    assert.equal(reenable.status, 200);

    const reset = await fetch(`${baseUrl}/api/auth/users/${employeeId}/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `xinyi_session=${adminLogin.session}`
      },
      body: JSON.stringify({ password: 'new-pass-123' })
    });
    const resetBody = await reset.json();
    assert.equal(reset.status, 200);
    assert.equal(resetBody.data.user.id, employeeId);
    assert.equal(resetBody.data.user.mustChangePassword, true);

    const oldSession = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: `xinyi_session=${employeeLogin.session}` }
    });
    assert.equal(oldSession.status, 401);

    const oldPassword = await login(baseUrl, employeeEmail, 'initial-pass');
    assert.equal(oldPassword.res.status, 403);

    const newPassword = await login(baseUrl, employeeEmail, 'new-pass-123');
    assert.equal(newPassword.res.status, 200);
    assert.ok(newPassword.session);
    assert.equal(newPassword.body.data.user.mustChangePassword, true);

    const wrongCurrent = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `xinyi_session=${newPassword.session}`
      },
      body: JSON.stringify({ currentPassword: 'wrong-pass', newPassword: 'final-pass-123' })
    });
    assert.equal(wrongCurrent.status, 403);

    const changePassword = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `xinyi_session=${newPassword.session}`
      },
      body: JSON.stringify({ currentPassword: 'new-pass-123', newPassword: 'final-pass-123' })
    });
    const changePasswordBody = await changePassword.json();
    assert.equal(changePassword.status, 200);
    assert.equal(changePasswordBody.data.user.mustChangePassword, false);

    const changedLogin = await login(baseUrl, employeeEmail, 'final-pass-123');
    assert.equal(changedLogin.res.status, 200);
    assert.equal(changedLogin.body.data.user.mustChangePassword, false);

    const audit = await fetch(`${baseUrl}/api/auth/audit-logs`, {
      headers: { Cookie: `xinyi_session=${adminLogin.session}` }
    });
    const auditBody = await audit.json();
    assert.equal(audit.status, 200);
    const employeeLogs = auditBody.data.logs.filter((log) => log.targetUserId === employeeId);
    const actions = employeeLogs.map((log) => log.action);
    assert.ok(actions.includes('USER_CREATE'));
    assert.ok(actions.includes('USER_UPDATE'));
    assert.ok(actions.includes('USER_DISABLE'));
    assert.ok(actions.includes('USER_ENABLE'));
    assert.ok(actions.includes('PASSWORD_RESET'));
    assert.ok(actions.includes('PASSWORD_CHANGE'));
    assert.equal(employeeLogs.some((log) => JSON.stringify(log.metadata).includes('initial-pass')), false);
    assert.equal(employeeLogs.some((log) => JSON.stringify(log.metadata).includes('new-pass-123')), false);
    assert.equal(employeeLogs.some((log) => JSON.stringify(log.metadata).includes('final-pass-123')), false);
  } finally {
    await stopServerProcess(child);
  }
});
