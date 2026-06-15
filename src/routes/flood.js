'use strict';

const express = require('express');
const store = require('../data/store');
const { authRequired } = require('../auth');
const floodService = require('../services/floodService');
const {
  sendData,
  sendError,
  requireString,
  parseNumber,
  HttpError,
} = require('../utils/http');

const router = express.Router();

router.use(authRequired);

/** GET /api/flood/levels —— 所有区域当前响应等级。 */
router.get('/levels', (req, res) => {
  const levels = store.getAllResponseLevels();
  return sendData(res, 200, levels, { total: levels.length });
});

/**
 * GET /api/flood/levels/:district —— 某区域当前响应等级。
 * 返回：当前等级、触发指标、触发值、各指标详情。
 */
router.get('/levels/:district', (req, res) => {
  try {
    const district = requireString(req.params, 'district', { max: 64 });
    const level = floodService.getCurrentLevel(district);
    if (!level) {
      return sendData(res, 200, {
        district,
        currentLevel: 'normal',
        triggeredByIndicator: null,
        triggeredValue: 0,
        calculatedAt: null,
      });
    }
    return sendData(res, 200, level);
  } catch (err) {
    if (err instanceof HttpError) return sendError(res, err.status, err.message, err.details);
    throw err;
  }
});

/**
 * GET /api/flood/levels/:district/history —— 某区域等级变更历史。
 * 可选 query: limit（默认 100）
 */
router.get('/levels/:district/history', (req, res) => {
  try {
    const district = requireString(req.params, 'district', { max: 64 });
    const limit = parseNumber(req.query, 'limit', { min: 1, max: 1000 }) || 100;
    const history = floodService.getLevelHistory(district, { limit });
    return sendData(res, 200, history, { total: history.length });
  } catch (err) {
    if (err instanceof HttpError) return sendError(res, err.status, err.message, err.details);
    throw err;
  }
});

/**
 * GET /api/flood/rainfall/:district/curve —— 某区域时间窗内降雨曲线。
 * 必填 query: startTime, endTime
 * 返回按小时排列的雨量数据，缺失小时补 0。
 */
router.get('/rainfall/:district/curve', (req, res) => {
  try {
    const district = requireString(req.params, 'district', { max: 64 });
    const startTime = requireString(req.query, 'startTime', { max: 32 });
    const endTime = requireString(req.query, 'endTime', { max: 32 });

    const startDate = new Date(startTime);
    const endDate = new Date(endTime);

    if (isNaN(startDate.getTime())) {
      throw new HttpError(400, 'startTime 格式无效');
    }
    if (isNaN(endDate.getTime())) {
      throw new HttpError(400, 'endTime 格式无效');
    }
    if (startDate >= endDate) {
      throw new HttpError(400, 'startTime 必须早于 endTime');
    }
    if ((endDate.getTime() - startDate.getTime()) > 7 * 24 * 3600 * 1000) {
      throw new HttpError(400, '时间窗不能超过 7 天');
    }

    const curve = floodService.getRainfallCurve(district, startDate, endDate);
    return sendData(res, 200, curve, { total: curve.length });
  } catch (err) {
    if (err instanceof HttpError) return sendError(res, err.status, err.message, err.details);
    throw err;
  }
});

/**
 * POST /api/flood/levels/:district/recalculate —— 手动触发重新计算某区域等级。
 * 可选 body: calcTime（默认当前时间）
 */
router.post('/levels/:district/recalculate', (req, res) => {
  try {
    const district = requireString(req.params, 'district', { max: 64 });
    const calcTime = req.body.calcTime ? new Date(req.body.calcTime) : new Date();
    if (isNaN(calcTime.getTime())) {
      throw new HttpError(400, 'calcTime 格式无效');
    }

    const result = floodService.recalculateDistrictLevel(district, calcTime);
    return sendData(res, 200, result);
  } catch (err) {
    if (err instanceof HttpError) return sendError(res, err.status, err.message, err.details);
    throw err;
  }
});

module.exports = router;
