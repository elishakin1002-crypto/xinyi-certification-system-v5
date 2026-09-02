// 生成服务器上的 .env.local（不含 DATABASE_URL —— 那一行由服务器自己生成，
// 密码不经过我这边，也不落到任何日志里）。
//
// 原则：**AI 密钥从本地 .env.local 原样搬过去，从不打印**。
// 灰度开关照抄本地已验证的状态 —— 生产和测试过的行为必须一致，
// 上线时顺手「改一个小开关」是最容易出事的做法。
import fs from 'node:fs';

const src = fs.readFileSync('.env.local', 'utf8');
const local = {};
for (const line of src.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
  if (m) local[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

// 从本地原样搬运（含密钥）
const CARRY = [
  'KIMI_API_KEY', 'KIMI_BASE_URL', 'KIMI_MODEL',
  'GEMINI_API_KEY',
  'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL',
  'VITE_KIMI_BASE_URL', 'VITE_KIMI_MODEL',
];
// 灰度开关全部照抄
const flags = Object.keys(local).filter((k) => /^VITE_.*_(ENABLED|READ_ENABLED|WRITE_ENABLED)$/.test(k));

// 生产强制项
const PROD = {
  NODE_ENV: 'production',
  PORT: '3001',

  // 数据必须落 PostgreSQL，禁止静默退回文件存储
  XINYI_REQUIRE_POSTGRES: 'true',
  XINYI_AUTH_REQUIRE_POSTGRES: 'true',

  // 服务端授权 enforce，前后端都要求登录
  XINYI_AUTHZ_MODE: 'enforce',
  XINYI_SESSION_AUTH_REQUIRED: 'true',
  XINYI_SESSION_ROLE_ENFORCEMENT: 'true',
  VITE_AUTH_REQUIRED: '1',

  // ⚠️ HTTP 阶段必须是 false。
  // Secure cookie 只在 HTTPS 下发送，现在用 IP 访问没有证书，
  // 设成 true 的话谁都登不进来 —— 备案通过上了 HTTPS 再改成 true。
  XINYI_SESSION_COOKIE_SECURE: 'false',
  XINYI_SESSION_COOKIE_NAME: 'xinyi_session',
  XINYI_SESSION_TTL_MS: '604800000',
  XINYI_SESSION_SLIDING: 'true',

  // 示例数据必须关：真假数据混在一起，出问题分不清是系统的还是假数据造成的
  VITE_DEMO_SEED_ENABLED: '',

  /*
    系统管理员权限模式。
    'full'    与老板等权 —— 上线到稳定运行期间必须保持这个值
    'limited' 收窄为业务只读 + 账号管理

    显式写出来，不靠 constants.ts 里的默认值兜底：
    默认值是「碰巧对」，写在这里才是「有人决定过」。
    上线期出问题要能查全部数据，收窄了等于自断排查手段。
    什么时候改成 limited 由业务方决定，不是技术上的顺手优化。
  */
  VITE_SYS_ADMIN_MODE: 'full',

  VITE_AI_BACKEND_URL: '/api/ai',
  CORS_ALLOWED_ORIGINS: 'http://124.223.209.102',
  API_JSON_LIMIT: '25mb',

  // 情报雷达定时抓取
  INTEL_CRON_ENABLED: 'true',
  INTEL_CRON_HOUR: '8',
  INTEL_CRON_MINUTE: '55',

  // 企业微信没配密钥前保持关闭，否则会在同事那边制造噪音
  WECOM_PUSH_ENABLED: 'false',
};

const out = [];
out.push('# 生产环境配置 —— 由 make-prod-env.mjs 生成');
out.push('# DATABASE_URL 由服务器单独写入，密码从未离开这台机器');
out.push('');
out.push('# ── 从本地环境搬运 ──');
for (const k of CARRY) if (local[k]) out.push(`${k}=${local[k]}`);
out.push('');
out.push('# ── 灰度开关（照抄本地已验证状态）──');
for (const k of flags.sort()) out.push(`${k}=${local[k]}`);
out.push('');
out.push('# ── 生产强制项 ──');
for (const [k, v] of Object.entries(PROD)) out.push(`${k}=${v}`);
out.push('');

fs.writeFileSync(process.argv[2], out.join('\n'), { mode: 0o600 });

const missing = CARRY.filter((k) => !local[k]);
console.log(`已生成 ${out.length} 行；搬运密钥 ${CARRY.filter((k) => local[k]).length}/${CARRY.length}，灰度开关 ${flags.length} 个`);
if (missing.length) console.log(`本地缺失（服务器上也不会有）: ${missing.join(', ')}`);
