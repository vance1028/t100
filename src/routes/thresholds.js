'use strict';

const express = require('express');
const store = require('../data/store');
const { authRequired, requireRole } = require('../auth');
const {
  sendData,
  sendError,
  requireString,
  parseNumber,
  parseEnum,
  parseId,
  HttpError,
} = require('../utils/http');

const router = express.Router();

const INDICATORS = ['1h', '3h', '24h'];
const LEVELS = ['blue', 'yellow', 'orange', 'red'];

router.use(authRequired);

/** GET /api/thresholds —— 阈值列表，支持 district 过滤。 */
router.get('/', (req, res) => {
  const district = req.query.district === 'global' ? null : req.query.district;
  const thresholds = store.listThresholds(
    req.query.district !== undefined ? { district } : {}
  );
  return sendData(res, 200, thresholds, { total: thresholds.length });
});

/** GET /api/thresholds/:id —— 阈值详情。 */
router.get('/:id', (req, res) => {
  try {
    const id = parseId(req.params.id);
    const threshold = store.getThresholdById(id);
    if (!threshold) return sendError(res, 404, '阈值配置不存在');
    return sendData(res, 200, threshold);
  } catch (err) {
    if (err instanceof HttpError) return sendError(res, err.status, err.message, err.details);
    throw err;
  }
});

/** POST /api/thresholds —— 新建阈值配置（仅 admin）。 */
router.post('/', requireRole('admin'), (req, res) => {
  try {
    const data = parseThresholdBody(req.body, { isCreate: true });
    const existing = store.listThresholds({
      district: data.district === undefined ? null : data.district,
    }).filter(
      (t) => t.indicator === data.indicator && t.level === data.level
    );
    if (existing.length > 0) {
      return sendError(res, 409, '该区域、指标、等级的阈值已存在');
    }
    const threshold = store.createThreshold(data);
    return sendData(res, 201, threshold);
  } catch (err) {
    if (err instanceof HttpError) return sendError(res, err.status, err.message, err.details);
    throw err;
  }
});

/** PUT /api/thresholds/:id —— 更新阈值（仅可改阈值，仅 admin）。 */
router.put('/:id', requireRole('admin'), (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!store.getThresholdById(id)) return sendError(res, 404, '阈值配置不存在');
    const data = parseThresholdBody(req.body, { isCreate: false });
    const threshold = store.updateThreshold(id, data);
    return sendData(res, 200, threshold);
  } catch (err) {
    if (err instanceof HttpError) return sendError(res, err.status, err.message, err.details);
    throw err;
  }
});

/** DELETE /api/thresholds/:id —— 删除阈值（仅 admin）。 */
router.delete('/:id', requireRole('admin'), (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!store.getThresholdById(id)) return sendError(res, 404, '阈值配置不存在');
    store.deleteThreshold(id);
    return sendData(res, 200, { id });
  } catch (err) {
    if (err instanceof HttpError) return sendError(res, err.status, err.message, err.details);
    throw err;
  }
});

function parseThresholdBody(body, { isCreate }) {
  const data = {};

  if (isCreate) {
    if (body.district !== undefined && body.district !== null) {
      data.district = requireString(body, 'district', { max: 64 });
    } else {
      data.district = null;
    }
    data.indicator = parseEnum(body, 'indicator', INDICATORS, { required: true });
    data.level = parseEnum(body, 'level', LEVELS, { required: true });
  }

  if (isCreate || body.thresholdMm !== undefined) {
    data.thresholdMm = parseNumber(body, 'thresholdMm', { required: true, min: 0 });
  }

  return data;
}

module.exports = router;
