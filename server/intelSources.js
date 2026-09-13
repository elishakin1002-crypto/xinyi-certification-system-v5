/*
  ── 情报源默认清单（2026-09-13 配，金恩来授权我直接选）─────────────

  为什么要有「默认值」而不是只让用户在面板里填：
  在这之前 sourceUrls 是空的，「抓取今日情报」永远返回空，
  而界面只说「没有抓取到任何东西」—— 一个**装好就是坏的**功能。
  默认值让它装好即可用；用户在面板里填了就以面板为准（见 /api/intel/config）。

  这些源是逐个从生产机实抓验过的（同一个 fetch、同一个 UA、同一套去标签），
  只留下能取到 300 字以上真实正文的。淘汰掉的那些记在 REJECTED_SOURCES 里 ——
  写下来是为了下次有人想加源时不用再踩一遍，也让测试能钉住「别把它们加回来」。

  选源的逻辑（对一家做 ISO 体系认证咨询的公司而言，什么才算情报）：
  1. 认监委 / CNAS —— 认证规则本身变了，直接影响在手项目和对客户的话术
  2. 公共资源交易 + 中国政府采购网 —— 招标文件里写「须具备 ISO9001」就是商机
  3. 市场监管（国家 / 省 / 市）—— 抽检不合格、专项整治，是体系整改需求的源头
  4. 苍南 / 平阳 / 龙港 / 温州四地政府 —— 新建扩产、技改、专精特新评定，新厂要认证

  抓取时每个源只取前 4000 字，一次最多 12 个源，所以这里刻意压在 11 个 ——
  留一个位子给金恩来后面要加的固定源。
*/
const DEFAULT_INTEL_SOURCE_URLS = Object.freeze([
  'http://www.cnca.gov.cn/zwxx/gg/',      // 国家认监委 公告（认证机构注销/资质变动，最相关）
  'https://www.cnas.org.cn/',              // CNAS 中国合格评定国家认可委员会
  'https://www.samr.gov.cn/',              // 国家市场监督管理总局
  'https://zjamr.zj.gov.cn/',              // 浙江省市场监督管理局
  'https://wzmsa.wenzhou.gov.cn/',         // 温州市市场监督管理局
  'https://ggzyjy-eweb.wenzhou.gov.cn/',   // 温州市公共资源交易网（招标公告）
  'https://www.ccgp.gov.cn/',              // 中国政府采购网
  'https://www.cncn.gov.cn/',              // 苍南县人民政府
  'https://www.zjpy.gov.cn/',              // 平阳县人民政府
  'https://www.zjlg.gov.cn/',              // 龙港市人民政府
  'https://www.wenzhou.gov.cn/'            // 温州市人民政府
]);

/*
  试过、不能用的源。**别再加回去** —— 每一条后面是一次实抓的结果。

  注意 host 写成不带协议的形式：测试是拿 host 去比对清单的，
  免得有人换个 http/https 或者加个尾斜杠就绕过去了。
*/
const REJECTED_SOURCES = Object.freeze([
  { host: 'zfcg.czt.zj.gov.cn', why: '浙江政府采购网是纯前端渲染，直抓去完标签只剩 7 个字' },
  { host: 'ggzy.cncn.gov.cn', why: '苍南公共资源交易网对非浏览器 UA 直接返回 550' },
  { host: 'www.ccgp-zhejiang.gov.cn', why: '证书链在服务器上验不过（UNABLE_TO_VERIFY_LEAF_SIGNATURE）' },
  { host: 'www.cangnan.gov.cn', why: '不存在，苍南县政府的真实域名是 www.cncn.gov.cn' },
  { host: 'www.pingyang.gov.cn', why: '不存在，平阳县政府的真实域名是 www.zjpy.gov.cn' },
  { host: 'www.longgang.gov.cn', why: '不存在，龙港市政府的真实域名是 www.zjlg.gov.cn' },
  { host: 'wzsggzy.wenzhou.gov.cn', why: '不存在，温州公共资源交易网是 ggzyjy-eweb.wenzhou.gov.cn' }
]);

/*
  单个源抓回来的正文少于这个字数，就当作「这个源这次没取到」。

  为什么是 300 而不是原来的 60：温州市场监管局的「通知公告」「食品抽检」
  列表页直抓回来只有 91 字，全是「首页 > 政务公开 > 通知公告 / 政策文件 …」
  这排栏目名 —— 条目是脚本异步加载的，直抓根本拿不到。
  91 > 60，于是空壳被判成「抓到了」，喂给 AI，AI 什么也提不出来，
  用户最后看到的是「没有抓取到任何东西」。
  一条公告标题加日期大约 30-40 字，300 字意味着至少有几条真东西。
*/
const MIN_SOURCE_TEXT = 300;

/** 一次抓取最多取几个源（再多 AI 的上下文放不下，也拖慢整个请求） */
const MAX_SOURCES_PER_RUN = 12;

module.exports = {
  DEFAULT_INTEL_SOURCE_URLS,
  REJECTED_SOURCES,
  MIN_SOURCE_TEXT,
  MAX_SOURCES_PER_RUN
};
