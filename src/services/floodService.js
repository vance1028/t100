'use strict';

const store = require('../data/store');
const { getDb } = require('../db');
const calculator = require('../utils/floodCalculator');

/**
 * 批量上报降雨数据并重新计算相关区域的响应等级。
 *
 * 流程：
 * 1. 校验并规整数据（时间戳规整到小时整点）
 * 2. 批量写入/更新降雨记录
 * 3. 对涉及的每个区域，重新计算响应等级
 * 4. 若等级变化，记录历史
 *
 * @param {Array<{district: string, timestamp: string|Date, hourRainfall: number}>} records
 * @returns {{processed: number, districtResults: Array}}
 */
function ingestRainfall(records) {
  const processedRecords = records.map((r) => {
    const hourDate = calculator.floorToHour(r.timestamp);
    return {
      district: r.district,
      timestamp: calculator.formatDateTime(hourDate),
      hourRainfall: r.hourRainfall,
    };
  });

  const affectedDistricts = [...new Set(processedRecords.map((r) => r.district))];
  const processed = store.batchUpsertRainfall(processedRecords);

  const districtResults = [];
  const db = getDb();
  const tx = db.transaction(() => {
    const allThresholds = store.getAllThresholdsRaw();

    for (const district of affectedDistricts) {
      const batchLatest = processedRecords
        .filter((r) => r.district === district)
        .reduce((max, r) => {
          const ts = new Date(r.timestamp.replace(' ', 'T') + 'Z');
          return ts > max ? ts : max;
        }, new Date(0));

      const districtExisting = getDb()
        .prepare('SELECT MAX(timestamp) AS ts FROM rainfall_records WHERE district = ?')
        .get(district);

      let latestTs = batchLatest;
      if (districtExisting && districtExisting.ts) {
        const existingTs = new Date(districtExisting.ts.replace(' ', 'T') + 'Z');
        if (existingTs > latestTs) latestTs = existingTs;
      }

      const calcHour = calculator.floorToHour(latestTs);
      calcHour.setUTCHours(calcHour.getUTCHours() + 1);

      const currentHour = calcHour;
      const { start: windowStart } = calculator.getWindowRange(currentHour, 24);
      const startTimeStr = calculator.formatDateTime(windowStart);
      const endTimeStr = calculator.formatDateTime(currentHour);
      const rawRecords = store.getRainfallForCalculation(district, startTimeStr, endTimeStr);
      const result = calculator.calculateResponseLevel(
        district,
        rawRecords,
        allThresholds,
        currentHour
      );

      const newLevel = result.level || 'normal';
      const triggeredBy = result.triggeredBy || 'none';
      const triggeredValue = result.triggeredValue;

      const updateResult = store.updateResponseLevelWithHistory(
        district,
        newLevel,
        triggeredBy,
        triggeredValue,
        result.calculatedAt
      );

      districtResults.push({
        district,
        level: newLevel,
        triggeredBy,
        triggeredValue,
        changed: updateResult.changed,
        previousLevel: updateResult.oldLevel,
        indicators: result.indicators,
        calculatedAt: result.calculatedAt,
      });
    }
  });

  tx();

  return { processed, districtResults };
}

/**
 * 手动触发重新计算某区域的响应等级。
 */
function recalculateDistrictLevel(district, calcTime = new Date()) {
  const db = getDb();
  let result;

  const tx = db.transaction(() => {
    const allThresholds = store.getAllThresholdsRaw();
    const currentHour = calculator.floorToHour(calcTime);
    const { start: windowStart } = calculator.getWindowRange(currentHour, 24);
    const startTimeStr = calculator.formatDateTime(windowStart);
    const endTimeStr = calculator.formatDateTime(currentHour);

    const rawRecords = store.getRainfallForCalculation(district, startTimeStr, endTimeStr);
    const calcResult = calculator.calculateResponseLevel(
      district,
      rawRecords,
      allThresholds,
      calcTime
    );

    const newLevel = calcResult.level || 'normal';
    const triggeredBy = calcResult.triggeredBy || 'none';
    const triggeredValue = calcResult.triggeredValue;

    const updateResult = store.updateResponseLevelWithHistory(
      district,
      newLevel,
      triggeredBy,
      triggeredValue,
      calcResult.calculatedAt
    );

    result = {
      district,
      level: newLevel,
      triggeredBy,
      triggeredValue,
      changed: updateResult.changed,
      previousLevel: updateResult.oldLevel,
      indicators: calcResult.indicators,
      calculatedAt: calcResult.calculatedAt,
    };
  });

  tx();
  return result;
}

/**
 * 获取某区域当前响应等级。
 */
function getCurrentLevel(district) {
  return store.getResponseLevelByDistrict(district);
}

/**
 * 获取某区域等级变更历史。
 */
function getLevelHistory(district, options = {}) {
  return store.getLevelHistory(district, options);
}

/**
 * 获取某区域时间窗内的降雨曲线数据（按小时）。
 * 缺失的小时点补 0。
 */
function getRainfallCurve(district, startTime, endTime) {
  const startHour = calculator.floorToHour(startTime);
  const endHour = calculator.floorToHour(endTime);

  const startStr = calculator.formatDateTime(startHour);
  const endStr = calculator.formatDateTime(endHour);

  const records = store.getRainfallByRange(district, startStr, endStr);
  const recordMap = new Map(records.map((r) => [r.timestamp, r.hourRainfall]));

  const curve = [];
  let current = new Date(startHour);
  while (current < endHour) {
    const ts = calculator.formatDateTime(current);
    curve.push({
      timestamp: ts,
      hourRainfall: recordMap.get(ts) || 0,
    });
    current.setHours(current.getHours() + 1);
  }

  return curve;
}

module.exports = {
  ingestRainfall,
  recalculateDistrictLevel,
  getCurrentLevel,
  getLevelHistory,
  getRainfallCurve,
};
