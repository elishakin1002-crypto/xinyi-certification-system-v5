import { ActionCode, RoleID } from '../../../types';
import { AI_ACTION_PERMISSION, AI_ACTION_LABEL } from './actionPermissions';

/**
 * 告诉 AI「现在是谁在跟它说话」。
 *
 * ── 为什么原来没有，为什么必须有 ─────────────────────────────
 * 2026-08-31 老板问 AI「我是谁」，AI 答「我这边看不到你的身份信息」。
 *
 * 权限那三道闸是知道的（checkActionPermission 用的就是登录用户），
 * 但**对话本身是身份盲的**——提示词里一个字都没提。后果不只是答不出这一句：
 *
 *   · 顾问问「这个客户为什么流失」，AI 可能顺口说出成交价
 *   · 销售问「这单该怎么报价」，AI 不知道他能不能看金额
 *   · 谁问都是同一套话，该说的没说、不该说的说了
 *
 * ── 落的是这条原则的后半句 ───────────────────────────────────
 *   AI 能做的，不能超过让它做的那个人自己能做的（动作映射表，已落地）
 *   **AI 能说的，不能超过那个人自己能看到的**（这里）
 *
 * ── 这不是安全边界 ──────────────────────────────────────────
 * 提示词是软约束，模型可能不照做。真正的边界是服务端授权。
 * 这里解决的是**说话得体**：让 AI 知道分寸，而不是靠拦截去堵每一句话。
 */

const ROLE_NAME: Record<string, string> = {
  ADMIN: '老板（总经理）',
  SYS_ADMIN: '系统管理员',
  MANAGER: '总经理助理',
  SALES: '销售',
  CONSULTANT: '咨询顾问',
  FINANCE: '财务',
};

/**
 * 各角色的说话口径。
 *
 * **只写「不该说什么」，不写「该说什么」**——后者会把 AI 变成念稿机器。
 * 每条都对应一个真实顾虑，不是泛泛的谨慎。
 */
const ROLE_TONE: Partial<Record<RoleID, string>> = {
  CONSULTANT:
    '不要讨论合同金额、报价、提成，也不要拿不同客户或不同同事做金额比较——' +
    '顾问在系统里看不到这些，你说了等于绕过了权限。' +
    '被问到时直接说「价格的事要问总经理」。',
  SALES:
    '可以谈他自己经手的合同金额和报价，但不要透露别人的提成、别人客户的成交价。',
  FINANCE:
    '可以谈金额、回款、结算。不要替业务方判断该不该继续服务某个客户，那是总经理的决定。',
  MANAGER:
    '可以谈进度、分工、合同金额。不要谈提成明细——那不在总助的范围内。',
};

export interface IdentityInput {
  name?: string;
  roles?: RoleID[];
  activeRole?: RoleID;
}

/**
 * @param can 判断某个动作能不能做。传进来而不是在这里算，
 *            是为了和界面用的是同一份判定，不另起一套。
 */
export const buildIdentityContext = (
  user: IdentityInput | null | undefined,
  can: (action: ActionCode) => boolean,
): string => {
  if (!user) {
    // 没有登录用户时如实说，不要假装知道
    return '\n### 当前用户\n未登录或身份未知。不要猜测对方是谁，也不要执行任何写操作。\n';
  }

  const roles = Array.isArray(user.roles) ? user.roles : [];
  const roleNames = roles.map((r) => ROLE_NAME[r] || r).join('、') || '未分配角色';

  const allowed: string[] = [];
  const denied: string[] = [];
  for (const [key, action] of Object.entries(AI_ACTION_PERMISSION)) {
    (can(action) ? allowed : denied).push(AI_ACTION_LABEL[key] || key);
  }

  /*
    口径按**所有角色的并集**取。一人多角色时，
    如果按最严的算，销售兼顾问就谈不了自己的单子了——
    而他本来就能看到那些金额，AI 反而比界面还紧，那是添乱。
  */
  const tones = roles.map((r) => ROLE_TONE[r]).filter(Boolean) as string[];

  const lines = [
    '',
    '### 当前用户',
    `姓名：${user.name || '（未填姓名）'}`,
    `角色：${roleNames}`,
    '',
    '被问到「我是谁」「我什么身份」时，就照上面回答。',
    '',
    `他可以让你做：${allowed.join('、') || '（无）'}`,
  ];
  if (denied.length > 0) {
    lines.push(`他**不能**让你做：${denied.join('、')}。被要求时直接说这件事要找总经理，不要输出动作块。`);
  }
  if (tones.length > 0) {
    lines.push('', '说话分寸：', ...tones.map((t) => `· ${t}`));
  }
  lines.push('');
  return lines.join('\n');
};
