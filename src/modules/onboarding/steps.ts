import { RoleID } from '../../../types';

/**
 * 新手引导：按角色讲「你打开这个系统，第一件事该做什么」。
 *
 * ── 为什么按角色分，不做一套通用的 ────────────────────────────
 * 通用引导会把所有功能都过一遍，而顾问根本用不到财务、
 * 财务也不管交付进度。看一堆和自己无关的东西，
 * 结果是**该记住的那三步反而没记住**。
 *
 * ── 为什么只讲三到五步 ────────────────────────────────────────
 * 引导的目的不是教会全部功能，是让人**今天能把活干完**。
 * 剩下的边用边问 AI 助手就行 —— 那才是这套系统的设计意图。
 *
 * 十步以上的引导，人会从第四步开始一路点「下一步」，
 * 等于没看。三步他会真的读。
 *
 * ── 每一步都要说「为什么」，不只是「点哪里」 ──────────────────
 * 「点这里新建线索」——记不住。
 * 「客户是老板在外面谈来的，你把他记进来，系统才知道该提醒谁跟进」
 * ——这个能记住，因为它接上了他本来就懂的事。
 */

export interface OnboardStep {
  /** 高亮哪个元素。用 data-onboard 属性选，不用 class —— class 改样式时会被误删 */
  target?: string;
  title: string;
  body: string;
  /** 引导到这一步时把人带到哪个页面 */
  route?: string;
}

export interface OnboardTour {
  /** 版本号。内容有实质更新时 +1，看过旧版的人会再看一次新版 */
  version: number;
  intro: string;
  steps: OnboardStep[];
}

const COMMON_END: OnboardStep = {
  target: 'ai-chat',
  title: '不会的直接问它',
  body: '右下角这个是 AI 助手。**它知道你是谁、能看到什么**，'
    + '所以可以直接问「我这个月要跟哪些客户」「这个合同怎么录」。\n\n'
    + '**不用怕问错。** 它做不了你自己做不了的事 —— 权限是一样的。',
};

const FEEDBACK_END: OnboardStep = {
  target: 'feedback',
  title: '卡住了就点这里',
  body: '用着觉得别扭、点了没反应、或者不确定该怎么操作，点这个图标说一声。\n\n'
    + '**「我不知道怎么操作」也值得提** —— 那多半是系统设计得不好，不是你的问题。'
    + '而且一个人不会用，通常意味着还有几个人也不会，只是没说。',
};

export const TOURS: Partial<Record<RoleID, OnboardTour>> = {
  CONSULTANT: {
    version: 1,
    intro: '你是咨询顾问。这套系统对你来说，主要解决三件事：\n\n'
      + '**手上的项目进度别乱、工时有记录、要交的材料有地方放。**\n\n'
      + '大概两分钟，我带你过一遍。',
    steps: [
      {
        route: '/projects', target: 'nav-projects',
        title: '项目管理：你每天最常来的地方',
        body: '你负责的项目都在这里。每个项目下面是任务和节点。\n\n'
          + '**项目延期最常见的原因不是做不完，是没人发现它卡住了。**'
          + '你把进度更新上，系统才能提前提醒，而不是等客户来催。',
      },
      {
        route: '/projects', target: 'work-log',
        title: '工时记录：不是为了考核',
        body: '记工时是为了两件事：**结算有依据**，以及**下次报价时知道这类项目真实要花多少人天**。\n\n'
          + '不用记得很细，一天一条、写清做了什么就够。',
      },
      {
        route: '/audit', target: 'nav-audit',
        title: '不符合项：客户审核出来的问题',
        body: '现场审核发现的不符合项记在这里，整改完了勾掉。\n\n'
          + '**这是你们卖给客户的东西** —— 「偏离流程必须有记录和理由」，'
          + '公司自己也照这个做。',
      },
      {
        route: '/knowledge', target: 'nav-knowledge',
        title: '知识中心：先在这里找，找不到再问人',
        body: '体系文件、模板、以前项目的做法都在这里。\n\n'
          + '**别存客户填好的记录表** —— 那是客户的经营数据，'
          + '放进我们系统有合规风险。空白模板可以。',
      },
      COMMON_END,
      FEEDBACK_END,
    ],
  },

  FINANCE: {
    version: 1,
    intro: '你管财务。这套系统对你来说是**一本能自动对上的账**：\n\n'
      + '合同签了多少、回款到了多少、顾问该结多少，三件事连在一起。',
    steps: [
      {
        route: '/finance', target: 'nav-finance',
        title: '回款概览：先看逾期',
        body: '按合同列出应收和已收。**红色的是逾期未收**，那是每天第一眼该看的。\n\n'
          + '确认到账之后，项目的付款状态和客户的价值分级会自动跟着变，不用你再去改一遍。',
      },
      {
        route: '/finance/settlements', target: 'nav-settlements',
        title: '顾问结算：数据是自动来的',
        body: '结算金额来自项目的工时和合同金额，不是手工填的。\n\n'
          + '**所以顾问按时记工时，你才不用月底去追着问。**',
      },
      {
        route: '/contracts', target: 'nav-contracts',
        title: '合同：金额的唯一出处',
        body: '所有金额的源头都在合同这里。**改合同金额会连带影响提成和业绩**，'
          + '所以系统把它记进操作账本 —— 谁改的、什么时候、为什么，都能查。',
      },
      COMMON_END,
      FEEDBACK_END,
    ],
  },

  MANAGER: {
    version: 1,
    intro: '你是总经理助理，替总经理盯全局。\n\n'
      + '你最需要的三个数：**谁手上活太多、哪个项目要延期、这周有没有人没记日志。**',
    steps: [
      {
        route: '/dashboard', target: 'team-capacity',
        title: '团队产能与执行',
        body: '工作台下半部分这一块是给你看的：人均在制项目数、项目延误率、本周日志覆盖率。\n\n'
          + '**日志覆盖率低不代表大家在偷懒**，多半是某个环节太麻烦。看到低了先去问，别先下结论。',
      },
      {
        route: '/projects', target: 'nav-projects',
        title: '项目管理：派活和调整',
        body: '你可以建项目、指派负责人、调整进度。\n\n'
          + '**你不碰钱** —— 确认到账和结算是财务的事，这是有意分开的。',
      },
      {
        route: '/leads', target: 'nav-leads',
        title: '线索：老板在外面谈到的，你记进来',
        body: '总经理常年在外跑业务，谈到的客户回来跟你说一声，你录进系统。\n\n'
          + '**录进来系统才会提醒跟进** —— 不然全靠人记，漏一个就是一单。',
      },
      COMMON_END,
      FEEDBACK_END,
    ],
  },

  ADMIN: {
    version: 1,
    intro: '你是总经理。这套系统给你的是**三个你平时问不到的数**：\n\n'
      + '钱有没有回来、活有没有卡住、客户有没有在流失。',
    steps: [
      {
        route: '/dashboard', target: 'boss-kpi',
        title: '工作台：先看风险，再看待办',
        body: '最上面是这个月的营收和**逾期未收金额**。红色那块是要立刻处理的。\n\n'
          + '下面是团队产能。**这两块合起来回答一个问题：这个月是不是在正常运转。**',
        },
      {
        route: '/strategy', target: 'nav-strategy',
        title: '战略管理：每月一次的复盘',
        body: '默认标签是「月度经营复盘」，系统自动生成：签约趋势、逾期应收、'
          + '交付瓶颈、客户结构、数据缺口。\n\n'
          + '**「数据缺口」那一栏值得看** —— 它告诉你哪些结论现在还不可信，因为数据没录全。',
      },
      {
        target: 'view-switch',
        title: '切换视角：看看同事看到什么',
        body: '点头像 → 切换视角，可以看顾问、财务、销售各自打开系统是什么样。\n\n'
          + '**这是巡检工具，不是换身份** —— 权限一点不变，只是换一副眼镜。'
          + '用它可以判断权限配得对不对。',
      },
      COMMON_END,
      FEEDBACK_END,
    ],
  },

  SALES: {
    version: 1,
    intro: '你做销售。系统对你来说主要两件事：**线索别漏跟，成交后交付有人接。**',
    steps: [
      {
        route: '/leads', target: 'nav-leads',
        title: '线索管理：你的主战场',
        body: '新线索录进来，加跟进记录，成熟了转成客户。\n\n'
          + '**系统会按你设的时间提醒跟进** —— 不用自己记在本子上。',
      },
      {
        route: '/intel', target: 'nav-intel',
        title: '情报雷达：每天早上自动抓',
        body: '系统每天早上抓温州、苍南、平阳、龙港这几个地方的企业动态和招标信息。\n\n'
          + '**有价值的可以一键转成线索**，不用手工再录一遍。',
      },
      {
        route: '/projects', target: 'nav-projects',
        title: '项目交付：你能看进度但不改',
        body: '客户会问「证书什么时候下来」，你在这里查得到。\n\n'
          + '**看得到但改不了** —— 交付节奏由顾问和总助定，避免两头说法不一致。',
      },
      COMMON_END,
      FEEDBACK_END,
    ],
  },
};

/** 系统管理员不走业务引导 —— 他要的是那份「系统管理能力对照」，不是「怎么录线索」。 */
export const getTour = (roles: RoleID[] | undefined): OnboardTour | null => {
  const list = Array.isArray(roles) ? roles : [];
  // 一人多角色时按这个优先级：先给他"主业"那套
  const order: RoleID[] = ['ADMIN', 'MANAGER', 'FINANCE', 'CONSULTANT', 'SALES'];
  for (const r of order) {
    if (list.includes(r) && TOURS[r]) return TOURS[r]!;
  }
  return null;
};
