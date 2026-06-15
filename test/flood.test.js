'use strict';

process.env.DB_FILE = ':memory:';
process.env.SEED_ON_START = 'false';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createApp } = require('../src/app');
const { getDb, resetAll } = require('../src/db');
const { seed } = require('../src/seed');
const calculator = require('../src/utils/floodCalculator');

getDb();
const app = createApp();

async function login(username, password) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username, password });
  assert.equal(res.status, 200);
  return res.body.data.token;
}

test.beforeEach(() => {
  resetAll();
  seed({ force: true });
});

/* ==================== 核心计算逻辑单元测试 ==================== */

test('floodCalculator: floorToHour 正确规整到 UTC 小时整点', () => {
  const d = new Date('2026-06-15T14:35:20Z');
  const hour = calculator.floorToHour(d);
  assert.equal(hour.getUTCFullYear(), 2026);
  assert.equal(hour.getUTCMonth(), 5);
  assert.equal(hour.getUTCDate(), 15);
  assert.equal(hour.getUTCHours(), 14);
  assert.equal(hour.getUTCMinutes(), 0);
  assert.equal(hour.getUTCSeconds(), 0);
});

test('floodCalculator: formatDateTime 输出 UTC 时间字符串', () => {
  const d = new Date('2026-06-15T14:00:00Z');
  const s = calculator.formatDateTime(d);
  assert.equal(s, '2026-06-15 14:00:00');
});

test('floodCalculator: getWindowRange 左闭右开，正确覆盖 N 个整点', () => {
  const currentHour = new Date('2026-06-15T14:00:00Z');

  const range3h = calculator.getWindowRange(currentHour, 3);
  assert.equal(calculator.formatDateTime(range3h.start), '2026-06-15 11:00:00');
  assert.equal(calculator.formatDateTime(range3h.end), '2026-06-15 14:00:00');

  const range1h = calculator.getWindowRange(currentHour, 1);
  assert.equal(calculator.formatDateTime(range1h.start), '2026-06-15 13:00:00');
  assert.equal(calculator.formatDateTime(range1h.end), '2026-06-15 14:00:00');

  const range24h = calculator.getWindowRange(currentHour, 24);
  assert.equal(calculator.formatDateTime(range24h.start), '2026-06-14 14:00:00');
  assert.equal(calculator.formatDateTime(range24h.end), '2026-06-15 14:00:00');
});

test('floodCalculator: isInWindow 正确判断左闭右开', () => {
  const start = new Date('2026-06-15T11:00:00Z');
  const end = new Date('2026-06-15T14:00:00Z');

  assert.equal(calculator.isInWindow(new Date('2026-06-15T11:00:00Z'), start, end), true);
  assert.equal(calculator.isInWindow(new Date('2026-06-15T13:59:59Z'), start, end), true);
  assert.equal(calculator.isInWindow(new Date('2026-06-15T14:00:00Z'), start, end), false);
  assert.equal(calculator.isInWindow(new Date('2026-06-15T10:59:59Z'), start, end), false);
});

test('floodCalculator: calculateWindowSum 正确累加窗口内数据', () => {
  const records = [
    { timestamp: '2026-06-15 11:00:00', hour_rainfall: 5 },
    { timestamp: '2026-06-15 12:00:00', hour_rainfall: 10 },
    { timestamp: '2026-06-15 13:00:00', hour_rainfall: 15 },
    { timestamp: '2026-06-15 14:00:00', hour_rainfall: 20 },
  ];
  const start = new Date('2026-06-15T11:00:00Z');
  const end = new Date('2026-06-15T14:00:00Z');

  const sum = calculator.calculateWindowSum(records, start, end);
  assert.equal(sum, 30);
});

test('floodCalculator: matchThresholdLevel 正确匹配等级', () => {
  const thresholds = [
    { level: 'blue', threshold_mm: 10 },
    { level: 'yellow', threshold_mm: 30 },
    { level: 'orange', threshold_mm: 50 },
    { level: 'red', threshold_mm: 70 },
  ];

  assert.equal(calculator.matchThresholdLevel(5, thresholds), null);
  assert.equal(calculator.matchThresholdLevel(10, thresholds), 'blue');
  assert.equal(calculator.matchThresholdLevel(30, thresholds), 'yellow');
  assert.equal(calculator.matchThresholdLevel(60, thresholds), 'orange');
  assert.equal(calculator.matchThresholdLevel(100, thresholds), 'red');
});

test('floodCalculator: calculateResponseLevel 取三个指标最高等级', () => {
  const thresholds = [
    { district: null, indicator: '1h', level: 'blue', threshold_mm: 10 },
    { district: null, indicator: '1h', level: 'yellow', threshold_mm: 30 },
    { district: null, indicator: '3h', level: 'blue', threshold_mm: 20 },
    { district: null, indicator: '3h', level: 'orange', threshold_mm: 60 },
    { district: null, indicator: '24h', level: 'blue', threshold_mm: 50 },
    { district: null, indicator: '24h', level: 'red', threshold_mm: 100 },
  ];

  const records = [
    { timestamp: '2026-06-15 13:00:00', hour_rainfall: 25 },
    { timestamp: '2026-06-15 12:00:00', hour_rainfall: 25 },
    { timestamp: '2026-06-15 11:00:00', hour_rainfall: 25 },
  ];

  const result = calculator.calculateResponseLevel(
    '朝阳区',
    records,
    thresholds,
    new Date('2026-06-15T14:30:00Z')
  );

  assert.equal(result.level, 'orange');
  assert.equal(result.triggeredBy, '3h');
  assert.equal(result.triggeredValue, 75);

  const ind1h = result.indicators.find((i) => i.indicator === '1h');
  assert.equal(ind1h.value, 25);
  assert.equal(ind1h.level, 'blue');

  const ind3h = result.indicators.find((i) => i.indicator === '3h');
  assert.equal(ind3h.value, 75);
  assert.equal(ind3h.level, 'orange');
});

test('floodCalculator: calculateResponseLevel 可复现，相同输入相同输出', () => {
  const thresholds = [
    { district: null, indicator: '1h', level: 'blue', threshold_mm: 10 },
    { district: null, indicator: '1h', level: 'yellow', threshold_mm: 30 },
    { district: null, indicator: '3h', level: 'blue', threshold_mm: 20 },
    { district: null, indicator: '24h', level: 'blue', threshold_mm: 50 },
  ];

  const records = [
    { timestamp: '2026-06-15 13:00:00', hour_rainfall: 15 },
    { timestamp: '2026-06-15 12:00:00', hour_rainfall: 8 },
  ];

  const calcTime = new Date('2026-06-15T14:30:00Z');

  const r1 = calculator.calculateResponseLevel('朝阳区', records, thresholds, calcTime);
  const r2 = calculator.calculateResponseLevel('朝阳区', records, thresholds, calcTime);
  const r3 = calculator.calculateResponseLevel('朝阳区', records, thresholds, new Date(calcTime));

  assert.deepEqual(r1, r2);
  assert.deepEqual(r1, r3);
});

test('floodCalculator: 跨天窗口计算正确', () => {
  const currentHour = new Date('2026-06-15T02:00:00Z');
  const range = calculator.getWindowRange(currentHour, 3);

  assert.equal(calculator.formatDateTime(range.start), '2026-06-14 23:00:00');
  assert.equal(calculator.formatDateTime(range.end), '2026-06-15 02:00:00');

  const records = [
    { timestamp: '2026-06-14 23:00:00', hour_rainfall: 10 },
    { timestamp: '2026-06-15 00:00:00', hour_rainfall: 20 },
    { timestamp: '2026-06-15 01:00:00', hour_rainfall: 30 },
  ];

  const sum = calculator.calculateWindowSum(records, range.start, range.end);
  assert.equal(sum, 60);
});

/* ==================== 阈值配置 API 测试 ==================== */

test('阈值配置 CRUD 正常', async () => {
  const adminToken = await login('admin', 'admin123');
  const viewerToken = await login('viewer', 'viewer123');

  let res = await request(app)
    .post('/api/thresholds')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      district: null,
      indicator: '1h',
      level: 'blue',
      thresholdMm: 10,
    });
  assert.equal(res.status, 201);
  const id1 = res.body.data.id;

  res = await request(app)
    .post('/api/thresholds')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      district: null,
      indicator: '1h',
      level: 'yellow',
      thresholdMm: 30,
    });
  assert.equal(res.status, 201);

  res = await request(app)
    .post('/api/thresholds')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      district: '朝阳区',
      indicator: '1h',
      level: 'blue',
      thresholdMm: 15,
    });
  assert.equal(res.status, 201);

  res = await request(app)
    .get('/api/thresholds')
    .set('Authorization', `Bearer ${viewerToken}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 3);

  res = await request(app)
    .get('/api/thresholds?district=global')
    .set('Authorization', `Bearer ${viewerToken}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 2);

  res = await request(app)
    .get('/api/thresholds?district=朝阳区')
    .set('Authorization', `Bearer ${viewerToken}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 1);

  res = await request(app)
    .put(`/api/thresholds/${id1}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ thresholdMm: 12 });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.thresholdMm, 12);

  res = await request(app)
    .delete(`/api/thresholds/${id1}`)
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(res.status, 200);

  res = await request(app)
    .get('/api/thresholds')
    .set('Authorization', `Bearer ${viewerToken}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 2);
});

test('viewer 不能修改阈值配置', async () => {
  const viewerToken = await login('viewer', 'viewer123');

  const res = await request(app)
    .post('/api/thresholds')
    .set('Authorization', `Bearer ${viewerToken}`)
    .send({
      district: null,
      indicator: '1h',
      level: 'blue',
      thresholdMm: 10,
    });
  assert.equal(res.status, 403);
});

test('重复阈值配置返回 409', async () => {
  const adminToken = await login('admin', 'admin123');

  await request(app)
    .post('/api/thresholds')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      district: null,
      indicator: '1h',
      level: 'blue',
      thresholdMm: 10,
    });

  const res = await request(app)
    .post('/api/thresholds')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      district: null,
      indicator: '1h',
      level: 'blue',
      thresholdMm: 15,
    });
  assert.equal(res.status, 409);
});

/* ==================== 降雨上报与等级计算 API 测试 ==================== */

async function setupDefaultThresholds(token) {
  const configs = [
    { district: null, indicator: '1h', level: 'blue', thresholdMm: 10 },
    { district: null, indicator: '1h', level: 'yellow', thresholdMm: 30 },
    { district: null, indicator: '1h', level: 'orange', thresholdMm: 50 },
    { district: null, indicator: '1h', level: 'red', thresholdMm: 70 },
    { district: null, indicator: '3h', level: 'blue', thresholdMm: 20 },
    { district: null, indicator: '3h', level: 'yellow', thresholdMm: 50 },
    { district: null, indicator: '3h', level: 'orange', thresholdMm: 80 },
    { district: null, indicator: '3h', level: 'red', thresholdMm: 100 },
    { district: null, indicator: '24h', level: 'blue', thresholdMm: 50 },
    { district: null, indicator: '24h', level: 'yellow', thresholdMm: 100 },
    { district: null, indicator: '24h', level: 'orange', thresholdMm: 150 },
    { district: null, indicator: '24h', level: 'red', thresholdMm: 200 },
  ];

  for (const cfg of configs) {
    await request(app)
      .post('/api/thresholds')
      .set('Authorization', `Bearer ${token}`)
      .send(cfg);
  }
}

test('降雨数据上报后自动计算等级，等级变化记录历史', async () => {
  const adminToken = await login('admin', 'admin123');
  await setupDefaultThresholds(adminToken);

  const baseTime = Date.UTC(2026, 5, 15, 14, 0, 0);

  let res = await request(app)
    .post('/api/rainfall/batch')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      records: [
        { district: '朝阳区', timestamp: new Date(baseTime - 3600000).toISOString(), hourRainfall: 5 },
      ],
    });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.processed, 1);
  assert.equal(res.body.data.districtResults[0].district, '朝阳区');
  assert.equal(res.body.data.districtResults[0].level, 'normal');
  assert.equal(res.body.data.districtResults[0].changed, true);

  res = await request(app)
    .post('/api/rainfall/batch')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      records: [
        { district: '朝阳区', timestamp: new Date(baseTime - 3600000).toISOString(), hourRainfall: 15 },
      ],
    });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.districtResults[0].level, 'blue');
  assert.equal(res.body.data.districtResults[0].changed, true);
  assert.equal(res.body.data.districtResults[0].previousLevel, 'normal');
  assert.equal(res.body.data.districtResults[0].triggeredBy, '1h');

  res = await request(app)
    .post('/api/rainfall/batch')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      records: [
        { district: '朝阳区', timestamp: new Date(baseTime - 7200000).toISOString(), hourRainfall: 35 },
        { district: '朝阳区', timestamp: new Date(baseTime - 10800000).toISOString(), hourRainfall: 35 },
      ],
    });
  assert.equal(res.status, 200);
  const dr = res.body.data.districtResults[0];
  assert.equal(dr.level, 'orange');
  assert.equal(dr.changed, true);
  assert.equal(dr.previousLevel, 'blue');
  assert.equal(dr.triggeredBy, '3h');

  res = await request(app)
    .get('/api/flood/levels/朝阳区')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.currentLevel, 'orange');
  assert.equal(res.body.data.triggeredByIndicator, '3h');

  res = await request(app)
    .get('/api/flood/levels/朝阳区/history')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 3);

  const history = res.body.data;
  assert.equal(history[0].fromLevel, 'blue');
  assert.equal(history[0].toLevel, 'orange');
  assert.equal(history[0].triggeredByIndicator, '3h');

  assert.equal(history[1].fromLevel, 'normal');
  assert.equal(history[1].toLevel, 'blue');
  assert.equal(history[1].triggeredByIndicator, '1h');

  assert.equal(history[2].fromLevel, null);
  assert.equal(history[2].toLevel, 'normal');
});

test('降雨曲线查询正确补全缺失小时', async () => {
  const adminToken = await login('admin', 'admin123');

  const baseTime = Date.UTC(2026, 5, 15, 14, 0, 0);

  await request(app)
    .post('/api/rainfall/batch')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      records: [
        { district: '朝阳区', timestamp: new Date(baseTime - 3600000).toISOString(), hourRainfall: 10 },
        { district: '朝阳区', timestamp: new Date(baseTime - 10800000).toISOString(), hourRainfall: 20 },
      ],
    });

  const startTime = new Date(baseTime - 4 * 3600000).toISOString();
  const endTime = new Date(baseTime).toISOString();

  const res = await request(app)
    .get(`/api/flood/rainfall/朝阳区/curve?startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`)
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.total, 4);

  const curve = res.body.data;
  assert.equal(curve[0].hourRainfall, 0);
  assert.equal(curve[1].hourRainfall, 20);
  assert.equal(curve[2].hourRainfall, 0);
  assert.equal(curve[3].hourRainfall, 10);
});

test('区域特定阈值优先于全局默认', async () => {
  const adminToken = await login('admin', 'admin123');

  await request(app)
    .post('/api/thresholds')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ district: null, indicator: '1h', level: 'blue', thresholdMm: 100 });

  await request(app)
    .post('/api/thresholds')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ district: '海淀区', indicator: '1h', level: 'blue', thresholdMm: 10 });

  const baseTime = Date.UTC(2026, 5, 15, 14, 0, 0);

  await request(app)
    .post('/api/rainfall/batch')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      records: [
        { district: '朝阳区', timestamp: new Date(baseTime - 3600000).toISOString(), hourRainfall: 50 },
        { district: '海淀区', timestamp: new Date(baseTime - 3600000).toISOString(), hourRainfall: 15 },
      ],
    });

  let res = await request(app)
    .get('/api/flood/levels/朝阳区')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(res.body.data.currentLevel, 'normal');

  res = await request(app)
    .get('/api/flood/levels/海淀区')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(res.body.data.currentLevel, 'blue');
});

test('降雨曲线时间窗超过7天返回400', async () => {
  const token = await login('admin', 'admin123');
  const startTime = '2026-06-01T00:00:00Z';
  const endTime = '2026-06-10T00:00:00Z';

  const res = await request(app)
    .get(`/api/flood/rainfall/朝阳区/curve?startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 400);
});

test('手动触发重新计算', async () => {
  const adminToken = await login('admin', 'admin123');
  await setupDefaultThresholds(adminToken);

  const baseTime = Date.UTC(2026, 5, 15, 14, 0, 0);

  await request(app)
    .post('/api/rainfall/batch')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      records: [
        { district: '朝阳区', timestamp: new Date(baseTime - 3600000).toISOString(), hourRainfall: 5 },
      ],
    });

  const res = await request(app)
    .post('/api/flood/levels/朝阳区/recalculate')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ calcTime: new Date(baseTime).toISOString() });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.level, 'normal');
});

test('批量上报空数组返回400', async () => {
  const token = await login('admin', 'admin123');
  const res = await request(app)
    .post('/api/rainfall/batch')
    .set('Authorization', `Bearer ${token}`)
    .send({ records: [] });
  assert.equal(res.status, 400);
});

test('批量上报超过1000条返回400', async () => {
  const token = await login('admin', 'admin123');
  const records = new Array(1001).fill(null).map((_, i) => ({
    district: '朝阳区',
    timestamp: new Date(Date.UTC(2026, 5, 1, i, 0, 0)).toISOString(),
    hourRainfall: 1,
  }));
  const res = await request(app)
    .post('/api/rainfall/batch')
    .set('Authorization', `Bearer ${token}`)
    .send({ records });
  assert.equal(res.status, 400);
});
