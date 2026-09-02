// 看板指标路由（PG 数据 + 复用 buildDashboardMetrics）。DB 未启用 → 落回旧逻辑（旧无此接口，将 404）。
const express = require('express');
const pool = require('../db/pool');
const { computeDashboard } = require('../services/dashboardService');
const { sendSuccess, sendFail, ERROR_CODES } = require('../utils/apiResponse');

const router = express.Router();
router.use((req, res, next) => (pool.isEnabled() ? next() : next('router')));

router.get('/api/dashboard/metrics', async (req, res) => {
  try {
    const bundle = await computeDashboard({ role: req.query.role, userName: req.query.userName });
    return sendSuccess(res, bundle, 'success');
  } catch (e) {
    return sendFail(res, ERROR_CODES.SERVER_ERROR, e?.message || 'dashboard metrics failed', {}, 500);
  }
});

module.exports = router;
