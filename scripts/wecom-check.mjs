#!/usr/bin/env node
/*
  企业微信接入自检。拿到密钥后**第一件事**就跑它。

    npm run wecom:check                    只验连通，不发消息
    npm run wecom:check -- --to ZhangSan   给指定成员发一条测试消息
    npm run wecom:check -- --group         往群机器人发一条测试消息

  默认只换 access_token、不发消息——自检不该打扰同事。
  要真发的时候再加 --to 或 --group。
*/
import process from 'node:process';
import { createRequire } from 'node:module';
import { loadEnv } from './lib/backupCommon.mjs';

const require = createRequire(import.meta.url);
const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };

const argOf = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? (process.argv[i + 1] || true) : null; };

const main = async () => {
  try { loadEnv(); } catch { /* 没有数据库配置也能查微信，忽略 */ }
  const wecom = require('../server/services/wecom');

  console.log(`\n${C.b}企业微信接入自检${C.x}\n`);

  // ── 配置齐不齐 ──
  const need = [
    ['WECOM_CORP_ID', '企业 ID，企业微信管理后台「我的企业」页面最下方'],
    ['WECOM_AGENT_ID', '自建应用的 AgentId，在「应用管理」里点进你建的应用'],
    ['WECOM_SECRET', '同一个应用页面里的 Secret，点「查看」后会发到你的企业微信'],
  ];
  let missing = 0;
  for (const [k, hint] of need) {
    const v = String(process.env[k] || '').trim();
    if (v) console.log(`  ${C.g}✓${C.x} ${k.padEnd(16)} ${C.d}${v.slice(0, 6)}***${C.x}`);
    else { missing++; console.log(`  ${C.r}✗${C.x} ${k.padEnd(16)} ${C.d}${hint}${C.x}`); }
  }
  const webhook = String(process.env.WECOM_GROUP_WEBHOOK || '').trim();
  console.log(`  ${webhook ? `${C.g}✓${C.x}` : `${C.y}−${C.x}`} WECOM_GROUP_WEBHOOK ${C.d}${webhook ? '已配置（群机器人）' : '未配置，群消息不可用（可选）'}${C.x}`);

  if (missing) {
    console.log(`\n${C.r}还差 ${missing} 项配置，先补齐再跑。${C.x}`);
    console.log(`${C.d}配置写在 .env.local 里，格式见 .env.example${C.x}\n`);
    process.exit(1);
  }

  // ── 连通性 ──
  console.log(`\n${C.d}换取 access_token…${C.x}`);
  const conn = await wecom.checkConnectivity();
  if (!conn.ok) {
    console.log(`  ${C.r}✗ 连不通：${conn.reason}${C.x}\n`);
    console.log(`${C.d}常见原因：${C.x}`);
    console.log(`${C.d}  · Secret 复制时带了空格${C.x}`);
    console.log(`${C.d}  · 服务器 IP 不在应用的「企业可信 IP」白名单里${C.x}`);
    console.log(`${C.d}  · CorpId 用成了别的企业的${C.x}\n`);
    process.exit(1);
  }
  console.log(`  ${C.g}✓ 连通${C.x} ${C.d}corpId ${conn.corpId} · agentId ${conn.agentId}${C.x}`);

  // ── 可选：真发一条 ──
  const to = argOf('to');
  if (to && typeof to === 'string') {
    console.log(`\n${C.d}给 ${to} 发测试消息…${C.x}`);
    const r = await wecom.sendToUser(to, '【信义系统】接入自检：这是一条测试消息，收到即表示应用消息通道正常。');
    console.log(r.ok ? `  ${C.g}✓ 已发送${C.x}${r.partial ? ` ${C.y}（${r.reason}）${C.x}` : ''}`
                     : `  ${C.r}✗ ${r.reason}${C.x}`);
    if (!r.ok) {
      console.log(`${C.d}  注意 touser 要填企业微信 userid，不是姓名也不是手机号${C.x}`);
    }
  }

  if (argOf('group')) {
    console.log(`\n${C.d}往群机器人发测试消息…${C.x}`);
    const r = await wecom.sendToGroup(null, '【信义系统】接入自检：群通道正常。');
    console.log(r.ok ? `  ${C.g}✓ 已发送${C.x}` : `  ${C.r}✗ ${r.reason}${C.x}`);
  }

  console.log(`\n${C.b}下一步${C.x}`);
  console.log(`  1. 在「员工账号」里给每个人填上企业微信 userid（没填的人收不到推送）`);
  console.log(`  2. ${C.d}npm run wecom:check -- --to <某个userid>${C.x} 确认能发到本人`);
  console.log(`  3. 设 ${C.d}WECOM_PUSH_ENABLED=true${C.x} 打开提醒推送\n`);
};

main().catch((e) => { console.error(`\n${C.r}自检失败：${C.x}`, e.message); process.exit(1); });
