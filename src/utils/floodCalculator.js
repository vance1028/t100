'use strict';

const LEVEL_ORDER = ['blue', 'yellow', 'orange', 'red'];
const LEVEL_WEIGHT = { blue: 0, yellow: 1, orange: 2, red: 3 };
const INDICATORS = ['1h', '3h', '24h'];

/**
 * 将时间向下规整到小时整点（UTC 时间）。
 * 纯函数：相同输入永远返回相同输出。
 * 所有时间统一使用 UTC，确保跨时区可复现。
 * @param {Date|string|number} date
 * @returns {Date} 整点的 Date 对象（分钟、秒、毫秒均为 0，UTC）
 */
function floorToHour(date) {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

/**
 * 格式化 Date 为 SQLite 兼容的 UTC 时间字符串（YYYY-MM-DD HH:MM:SS）。
 */
function formatDateTime(d) {
  const pad = (n) => n.toString().padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:00:00`;
}

/**
 * 解析 SQLite UTC 时间字符串为 Date。
 */
function parseDateTime(s) {
  return new Date(s.replace(' ', 'T') + 'Z');
}

/**
 * 计算时间窗口的起止范围。
 * 核心约定：窗口为左闭右开 [start, end)。
 *
 * 例：currentHour = 14:00, hours = 3
 *     → windowStart = 11:00, windowEnd = 14:00
 *     → 包含 11:00、12:00、13:00 三个整点的数据
 *
 * @param {Date} currentHour - 当前整点时间
 * @param {number} hours - 窗口大小（小时）
 * @returns {{start: Date, end: Date}}
 */
function getWindowRange(currentHour, hours) {
  const end = new Date(currentHour);
  const start = new Date(currentHour);
  start.setUTCHours(start.getUTCHours() - hours);
  return { start, end };
}

/**
 * 判断一个时间戳是否落在窗口内（左闭右开）。
 * @param {Date} ts - 数据点时间（已规整到整点）
 * @param {Date} start - 窗口开始（含）
 * @param {Date} end - 窗口结束（不含）
 */
function isInWindow(ts, start, end) {
  return ts >= start && ts < end;
}

/**
 * 计算指定窗口内的累计降雨量。
 * 纯函数：相同 records + 窗口参数 → 相同结果。
 *
 * @param {Array<{timestamp: string, hour_rainfall: number}>} records - 降雨记录
 * @param {Date} windowStart - 窗口开始（含）
 * @param {Date} windowEnd - 窗口结束（不含）
 * @returns {number} 累计雨量（毫米）
 */
function calculateWindowSum(records, windowStart, windowEnd) {
  let sum = 0;
  for (const rec of records) {
    const ts = parseDateTime(rec.timestamp);
    if (isInWindow(ts, windowStart, windowEnd)) {
      sum += rec.hour_rainfall;
    }
  }
  return sum;
}

/**
 * 根据单指标值和该指标的四级阈值，判断达到的等级。
 * 阈值规则：>= 阈值即触发该等级。
 *
 * @param {number} value - 指标计算值
 * @param {Array<{level: string, threshold_mm: number}>} thresholds - 该指标的阈值列表
 * @returns {string|null} 达到的最高等级，未触发任何等级返回 null
 */
function matchThresholdLevel(value, thresholds) {
  let matchedLevel = null;
  let matchedWeight = -1;

  for (const t of thresholds) {
    if (value >= t.threshold_mm) {
      const weight = LEVEL_WEIGHT[t.level];
      if (weight > matchedWeight) {
        matchedWeight = weight;
        matchedLevel = t.level;
      }
    }
  }

  return matchedLevel;
}

/**
 * 从阈值配置中提取某个指标的阈值列表。
 * 优先使用区域特定配置，缺失则回退到全局默认（district=NULL）。
 *
 * @param {Array} allThresholds - 所有阈值配置
 * @param {string} district - 区域
 * @param {string} indicator - 指标（1h/3h/24h）
 * @returns {Array<{level: string, threshold_mm: number}>}
 */
function getThresholdsForIndicator(allThresholds, district, indicator) {
  const districtSpecific = allThresholds.filter(
    (t) => t.district === district && t.indicator === indicator
  );

  if (districtSpecific.length > 0) {
    return districtSpecific;
  }

  return allThresholds.filter(
    (t) => t.district === null && t.indicator === indicator
  );
}

/**
 * 核心：计算某区域在给定时间点的防汛响应等级。
 * 纯函数，可复现：相同输入 → 相同输出。
 *
 * 计算流程：
 * 1. 将 calcTime 规整到小时整点
 * 2. 分别计算 1h、3h、24h 三个窗口的累计雨量
 * 3. 每个指标根据阈值匹配最高等级
 * 4. 取三个指标中的最高等级作为最终等级
 *
 * @param {string} district - 区域
 * @param {Array} records - 该区域的降雨记录
 * @param {Array} thresholds - 所有阈值配置
 * @param {Date|string|number} calcTime - 计算时间点
 * @returns {{
 *   level: string|null,
 *   triggeredBy: string|null,
 *   triggeredValue: number,
 *   indicators: Array<{indicator: string, value: number, level: string|null}>,
 *   calculatedAt: string
 * }}
 */
function calculateResponseLevel(district, records, thresholds, calcTime) {
  const currentHour = floorToHour(calcTime);
  const calculatedAt = formatDateTime(currentHour);

  const indicatorResults = [];
  let finalLevel = null;
  let finalWeight = -1;
  let triggeredBy = null;
  let triggeredValue = 0;

  for (const indicator of INDICATORS) {
    const hours = parseInt(indicator, 10);
    const { start, end } = getWindowRange(currentHour, hours);
    const value = calculateWindowSum(records, start, end);

    const indThresholds = getThresholdsForIndicator(thresholds, district, indicator);
    const level = matchThresholdLevel(value, indThresholds);

    indicatorResults.push({ indicator, value, level });

    if (level !== null) {
      const weight = LEVEL_WEIGHT[level];
      if (weight > finalWeight) {
        finalWeight = weight;
        finalLevel = level;
        triggeredBy = indicator;
        triggeredValue = value;
      }
    }
  }

  return {
    level: finalLevel,
    triggeredBy,
    triggeredValue,
    indicators: indicatorResults,
    calculatedAt,
  };
}

/**
 * 比较两个等级，返回较高的那个。
 */
function maxLevel(levelA, levelB) {
  if (levelA === null) return levelB;
  if (levelB === null) return levelA;
  return LEVEL_WEIGHT[levelA] >= LEVEL_WEIGHT[levelB] ? levelA : levelB;
}

/**
 * 判断两个等级是否不同（null 视为无预警）。
 */
function levelChanged(oldLevel, newLevel) {
  return oldLevel !== newLevel;
}

module.exports = {
  LEVEL_ORDER,
  LEVEL_WEIGHT,
  INDICATORS,
  floorToHour,
  formatDateTime,
  parseDateTime,
  getWindowRange,
  isInWindow,
  calculateWindowSum,
  matchThresholdLevel,
  getThresholdsForIndicator,
  calculateResponseLevel,
  maxLevel,
  levelChanged,
};
