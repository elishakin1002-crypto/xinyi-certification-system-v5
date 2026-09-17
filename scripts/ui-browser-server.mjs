/**
 * 常驻浏览器服务 —— 让被沙箱关着的 AI 也能用真浏览器。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要有这个（2026-09-17）
 * ══════════════════════════════════════════════════════════════
 *
 * 派给 Codex 的第一轮数据交叉复核整轮作废，它的报告写着：
 *
 *   「Chromium 因 macOS Mach 端口注册被拒绝而在打开页面前退出。」
 *
 * 实测确认它没冤枉谁 —— `codex exec -s workspace-write` 的 seatbelt
 * 沙箱里，Chromium 在启动瞬间就被杀掉：
 *
 *   CHROMIUM=FAIL browserType.launch: Target page, context or browser has been closed
 *
 * 加 `sandbox_workspace_write.network_access=true` 能把 localhost 打通
 * （实测 HTTP=200），但救不了 Chromium —— 拦它的是 Mach 端口，不是网络。
 *
 * **所以别让沙箱里的进程去起浏览器。**
 * 浏览器由沙箱外的人（Claude 这边的 shell）起一次，常驻；
 * 沙箱里的 AI 通过 websocket 连进来用。它需要的权限就从
 * 「能起一个带 Mach 端口的子进程」降成了「能连一个本地端口」——
 * 后者刚好是 network_access 已经给的。
 *
 * 这条对以后接进来的任何命令行 AI 都成立，不是给 Codex 一个人打的补丁。
 *
 * ── 怎么用 ────────────────────────────────────────────────────
 *
 *   node scripts/ui-browser-server.mjs &        # 沙箱外起（codex-run.sh 会自动起）
 *   # 端点写在 .runtime/ui-browser-ws，ui-agent.mjs 会自己读
 *
 * 想在旁边看着它点（会真弹窗口）：
 *   HEADED=1 node scripts/ui-browser-server.mjs &
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const WS_FILE = process.env.UI_WS_FILE || '.runtime/ui-browser-ws';
const PID_FILE = `${WS_FILE}.pid`;

const server = await chromium.launchServer({ headless: !process.env.HEADED });

fs.mkdirSync(path.dirname(WS_FILE), { recursive: true });
const endpoint = server.wsEndpoint();
fs.writeFileSync(WS_FILE, endpoint, 'utf8');
/*
  自己登记 PID。
  不登记的话，别人（codex-run.sh 的 ensure_browser）判不出这个服务还活着，
  会再起一个 —— 2026-09-17 就这么多出来一个孤儿进程。
*/
fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');

console.log(`浏览器服务已就绪（PID ${process.pid}），端点写入 ${WS_FILE}`);
console.log('停止：kill <本进程 PID>（不要用 pkill 匹配文件名，会误杀别的项目）');

/*
  退出时清掉端点文件 —— 但**只清自己那份**。
  第一版无条件 unlink，结果收掉一个孤儿进程时，
  把正在服役的另一个服务写的端点一起删了，
  当场把 Codex 那一轮的浏览器连接掐断（它连不上就只能报「环境阻断」，
  而日志上看起来就像浏览器又坏了，根本查不到是谁删的）。
  判据用「文件里的内容还是不是我写的那个端点」，
  比按 PID 判可靠：PID 会被复用。
*/
const bye = async () => {
  try {
    if (fs.readFileSync(WS_FILE, 'utf8').trim() === endpoint) fs.unlinkSync(WS_FILE);
  } catch { /* 已经没了或不是我的 */ }
  try {
    if (fs.readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) fs.unlinkSync(PID_FILE);
  } catch { /* 同上 */ }
  await server.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
