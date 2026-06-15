'use strict';

const express = require('express');
const { authRequired, requireRole } = require('../auth');
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

/**
 * POST /api/rainfall/batch —— 批量上报降雨观测数据。
 *
 * 请求体：
 * {
 *   "records": [
 *     { "district": "朝阳区", "timestamp": "2026-06-15 14:00:00", "hourRainfall": 12.5 },
 *     ...
 *   ]
 * }
 *
 * 响应：
 * {
 *   "data": {
 *     "processed": 10,
 *     "districtResults": [
 *       { "district": "朝阳区", "level": "yellow", "changed": true, ... },
 *       ...
 *     ]
 *   }
 * }
 */
router.post('/batch', requireRole('admin', 'operator'), (req, res) => {
  try {
    if (!Array.isArray(req.body.records)) {
      throw new HttpError(400, 'records 必须是数组');
    }
    if (req.body.records.length === 0) {
      throw new HttpError(400, 'records 不能为空');
    }
    if (req.body.records.length > 1000) {
      throw new HttpError(400, '单次上报不能超过 1000 条');
    }

    const records = req.body.records.map((r, idx) => {
      if (!r || typeof r !== 'object') {
        throw new HttpError(400, `第 ${idx + 1} 条记录格式错误`);
      }
      return {
        district: requireString(r, 'district', { max: 64 }),
        timestamp: requireString(r, 'timestamp', { max: 32 }),
        hourRainfall: parseNumber(r, 'hourRainfall', { required: true, min: 0 }),
      };
    });

    const result = floodService.ingestRainfall(records);
    return sendData(res, 200, result);
  } catch (err) {
    if (err instanceof HttpError) return sendError(res, err.status, err.message, err.details);
    throw err;
  }
});

module.exports = router;
