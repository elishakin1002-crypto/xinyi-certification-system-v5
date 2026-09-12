// 测试替身：LoginSessions 只在事件回调里用到 authService，
// 纯函数 groupByDevice 用不到它。给个空壳让模块能加载。
module.exports = {
  authService: { listSessions: async () => ({ sessions: [] }), revokeSession: async () => {} },
};
