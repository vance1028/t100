'use strict';

const { getDb } = require('../db');
const { hashPassword } = require('../utils/password');

/**
 * 数据仓储层：所有 SQL 都集中在这里，路由层只调用这些方法。
 * 对外返回的对象统一用 camelCase 字段，便于前端消费。
 */

/* ----------------------------- 行 -> API 映射 ----------------------------- */

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    active: !!row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPipe(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    district: row.district,
    type: row.type,
    material: row.material,
    diameterMm: row.diameter_mm,
    lengthM: row.length_m,
    status: row.status,
    installedAt: row.installed_at,
    remark: row.remark,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapStation(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    district: row.district,
    capacityM3h: row.capacity_m3h,
    pumpCount: row.pump_count,
    status: row.status,
    location: row.location,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* --------------------------------- 用户 --------------------------------- */

function getUserByUsername(username) {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getUserById(id) {
  return mapUser(getDb().prepare('SELECT * FROM users WHERE id = ?').get(id));
}

/** 内部使用：返回包含 password_hash 的原始行。 */
function getRawUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function listUsers() {
  return getDb()
    .prepare('SELECT * FROM users ORDER BY id ASC')
    .all()
    .map(mapUser);
}

function createUser({ username, password, name, role = 'viewer', active = true }) {
  const info = getDb()
    .prepare(
      `INSERT INTO users (username, password_hash, name, role, active)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(username, hashPassword(password), name, role, active ? 1 : 0);
  return getUserById(info.lastInsertRowid);
}

function updateUser(id, fields) {
  const sets = [];
  const params = [];
  if (fields.name !== undefined) { sets.push('name = ?'); params.push(fields.name); }
  if (fields.role !== undefined) { sets.push('role = ?'); params.push(fields.role); }
  if (fields.active !== undefined) { sets.push('active = ?'); params.push(fields.active ? 1 : 0); }
  if (fields.password !== undefined) { sets.push('password_hash = ?'); params.push(hashPassword(fields.password)); }
  if (sets.length === 0) return getUserById(id);
  sets.push("updated_at = datetime('now')");
  params.push(id);
  getDb().prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getUserById(id);
}

function deleteUser(id) {
  return getDb().prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0;
}

/* ------------------------------- 排水管段 ------------------------------- */

function listPipes({ district, type, status, keyword } = {}) {
  const where = [];
  const params = [];
  if (district) { where.push('district = ?'); params.push(district); }
  if (type) { where.push('type = ?'); params.push(type); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (keyword) {
    where.push('(code LIKE ? OR remark LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return getDb()
    .prepare(`SELECT * FROM pipe_segments ${clause} ORDER BY id DESC`)
    .all(...params)
    .map(mapPipe);
}

function getPipeById(id) {
  return mapPipe(getDb().prepare('SELECT * FROM pipe_segments WHERE id = ?').get(id));
}

function getPipeByCode(code) {
  return mapPipe(getDb().prepare('SELECT * FROM pipe_segments WHERE code = ?').get(code));
}

function createPipe(data) {
  const info = getDb()
    .prepare(
      `INSERT INTO pipe_segments
        (code, district, type, material, diameter_mm, length_m, status, installed_at, remark)
       VALUES (@code, @district, @type, @material, @diameterMm, @lengthM, @status, @installedAt, @remark)`,
    )
    .run({
      code: data.code,
      district: data.district,
      type: data.type,
      material: data.material,
      diameterMm: data.diameterMm,
      lengthM: data.lengthM,
      status: data.status,
      installedAt: data.installedAt,
      remark: data.remark,
    });
  return getPipeById(info.lastInsertRowid);
}

function updatePipe(id, data) {
  const allowed = {
    district: 'district',
    type: 'type',
    material: 'material',
    diameterMm: 'diameter_mm',
    lengthM: 'length_m',
    status: 'status',
    installedAt: 'installed_at',
    remark: 'remark',
  };
  const sets = [];
  const params = [];
  for (const [key, col] of Object.entries(allowed)) {
    if (data[key] !== undefined) { sets.push(`${col} = ?`); params.push(data[key]); }
  }
  if (sets.length === 0) return getPipeById(id);
  sets.push("updated_at = datetime('now')");
  params.push(id);
  getDb().prepare(`UPDATE pipe_segments SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getPipeById(id);
}

function deletePipe(id) {
  return getDb().prepare('DELETE FROM pipe_segments WHERE id = ?').run(id).changes > 0;
}

/* -------------------------------- 泵站 -------------------------------- */

function listStations({ district, status, keyword } = {}) {
  const where = [];
  const params = [];
  if (district) { where.push('district = ?'); params.push(district); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (keyword) {
    where.push('(code LIKE ? OR name LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return getDb()
    .prepare(`SELECT * FROM pump_stations ${clause} ORDER BY id DESC`)
    .all(...params)
    .map(mapStation);
}

function getStationById(id) {
  return mapStation(getDb().prepare('SELECT * FROM pump_stations WHERE id = ?').get(id));
}

function getStationByCode(code) {
  return mapStation(getDb().prepare('SELECT * FROM pump_stations WHERE code = ?').get(code));
}

function createStation(data) {
  const info = getDb()
    .prepare(
      `INSERT INTO pump_stations
        (code, name, district, capacity_m3h, pump_count, status, location)
       VALUES (@code, @name, @district, @capacityM3h, @pumpCount, @status, @location)`,
    )
    .run({
      code: data.code,
      name: data.name,
      district: data.district,
      capacityM3h: data.capacityM3h,
      pumpCount: data.pumpCount,
      status: data.status,
      location: data.location,
    });
  return getStationById(info.lastInsertRowid);
}

function updateStation(id, data) {
  const allowed = {
    name: 'name',
    district: 'district',
    capacityM3h: 'capacity_m3h',
    pumpCount: 'pump_count',
    status: 'status',
    location: 'location',
  };
  const sets = [];
  const params = [];
  for (const [key, col] of Object.entries(allowed)) {
    if (data[key] !== undefined) { sets.push(`${col} = ?`); params.push(data[key]); }
  }
  if (sets.length === 0) return getStationById(id);
  sets.push("updated_at = datetime('now')");
  params.push(id);
  getDb().prepare(`UPDATE pump_stations SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getStationById(id);
}

function deleteStation(id) {
  return getDb().prepare('DELETE FROM pump_stations WHERE id = ?').run(id).changes > 0;
}

/* ------------------------------- 降雨记录 ------------------------------- */

function mapRainfallRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    district: row.district,
    timestamp: row.timestamp,
    hourRainfall: row.hour_rainfall,
    createdAt: row.created_at,
  };
}

/**
 * 批量插入降雨记录，同一区域同一小时已存在则更新雨量值。
 * @param {Array<{district: string, timestamp: string, hourRainfall: number}>} records
 * @returns {number} 实际处理的记录数
 */
function batchUpsertRainfall(records) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO rainfall_records (district, timestamp, hour_rainfall)
    VALUES (@district, @timestamp, @hourRainfall)
    ON CONFLICT(district, timestamp) DO UPDATE SET
      hour_rainfall = excluded.hour_rainfall,
      created_at = datetime('now')
  `);

  const tx = db.transaction((recs) => {
    let count = 0;
    for (const r of recs) {
      const info = stmt.run(r);
      count += info.changes;
    }
    return count;
  });

  return tx(records);
}

/**
 * 查询某区域在时间范围内的降雨记录（按时间升序）。
 * @param {string} district
 * @param {string} startTime - 开始时间（含）
 * @param {string} endTime - 结束时间（不含）
 */
function getRainfallByRange(district, startTime, endTime) {
  return getDb()
    .prepare(`
      SELECT * FROM rainfall_records
      WHERE district = ? AND timestamp >= ? AND timestamp < ?
      ORDER BY timestamp ASC
    `)
    .all(district, startTime, endTime)
    .map(mapRainfallRecord);
}

/**
 * 查询某区域时间范围内的降雨记录（用于计算响应等级）。
 * @param {string} district
 * @param {string} startTimeStr - 开始时间（含，已格式化）
 * @param {string} endTimeStr - 结束时间（不含，已格式化）
 */
function getRainfallForCalculation(district, startTimeStr, endTimeStr) {
  return getDb()
    .prepare(`
      SELECT * FROM rainfall_records
      WHERE district = ? AND timestamp >= ? AND timestamp < ?
      ORDER BY timestamp ASC
    `)
    .all(district, startTimeStr, endTimeStr);
}

/* ------------------------------- 阈值配置 ------------------------------- */

function mapThreshold(row) {
  if (!row) return null;
  return {
    id: row.id,
    district: row.district,
    indicator: row.indicator,
    level: row.level,
    thresholdMm: row.threshold_mm,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listThresholds({ district } = {}) {
  const where = [];
  const params = [];
  if (district !== undefined) {
    if (district === null) {
      where.push('district IS NULL');
    } else {
      where.push('district = ?');
      params.push(district);
    }
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return getDb()
    .prepare(`SELECT * FROM flood_thresholds ${clause} ORDER BY district IS NULL, district, indicator, level`)
    .all(...params)
    .map(mapThreshold);
}

function getThresholdById(id) {
  return mapThreshold(getDb().prepare('SELECT * FROM flood_thresholds WHERE id = ?').get(id));
}

function createThreshold({ district, indicator, level, thresholdMm }) {
  const info = getDb()
    .prepare(`
      INSERT INTO flood_thresholds (district, indicator, level, threshold_mm)
      VALUES (?, ?, ?, ?)
    `)
    .run(district, indicator, level, thresholdMm);
  return getThresholdById(info.lastInsertRowid);
}

function updateThreshold(id, { thresholdMm }) {
  getDb()
    .prepare(`
      UPDATE flood_thresholds
      SET threshold_mm = ?, updated_at = datetime('now')
      WHERE id = ?
    `)
    .run(thresholdMm, id);
  return getThresholdById(id);
}

function deleteThreshold(id) {
  return getDb().prepare('DELETE FROM flood_thresholds WHERE id = ?').run(id).changes > 0;
}

/** 获取所有阈值（内部计算用，返回原始行）。 */
function getAllThresholdsRaw() {
  return getDb().prepare('SELECT * FROM flood_thresholds').all();
}

/* --------------------------- 当前响应等级 --------------------------- */

function mapResponseLevel(row) {
  if (!row) return null;
  return {
    id: row.id,
    district: row.district,
    currentLevel: row.current_level,
    triggeredByIndicator: row.triggered_by_indicator,
    triggeredValue: row.triggered_value,
    calculatedAt: row.calculated_at,
    updatedAt: row.updated_at,
  };
}

function getResponseLevelByDistrict(district) {
  return mapResponseLevel(
    getDb().prepare('SELECT * FROM district_response_levels WHERE district = ?').get(district)
  );
}

function getAllResponseLevels() {
  return getDb()
    .prepare('SELECT * FROM district_response_levels ORDER BY district')
    .all()
    .map(mapResponseLevel);
}

/**
 * 更新区域响应等级，若等级变化则同时写入历史记录。
 * 必须在事务内调用。
 */
function updateResponseLevelWithHistory(district, newLevel, triggeredBy, triggeredValue, calculatedAt) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM district_response_levels WHERE district = ?').get(district);

  const oldLevel = existing ? existing.current_level : null;

  if (oldLevel === newLevel && existing) {
    db.prepare(`
      UPDATE district_response_levels
      SET calculated_at = ?, updated_at = datetime('now')
      WHERE district = ?
    `).run(calculatedAt, district);
    return { level: newLevel, changed: false, oldLevel, newLevel };
  }

  if (existing) {
    db.prepare(`
      UPDATE district_response_levels
      SET current_level = ?, triggered_by_indicator = ?, triggered_value = ?,
          calculated_at = ?, updated_at = datetime('now')
      WHERE district = ?
    `).run(newLevel, triggeredBy, triggeredValue, calculatedAt, district);
  } else {
    db.prepare(`
      INSERT INTO district_response_levels
        (district, current_level, triggered_by_indicator, triggered_value, calculated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(district, newLevel, triggeredBy, triggeredValue, calculatedAt);
  }

  db.prepare(`
    INSERT INTO level_change_history
      (district, from_level, to_level, changed_at, triggered_by_indicator, triggered_value)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(district, oldLevel, newLevel, calculatedAt, triggeredBy, triggeredValue);

  return { level: newLevel, changed: true, oldLevel, newLevel };
}

/* ----------------------------- 等级变更历史 ----------------------------- */

function mapHistory(row) {
  if (!row) return null;
  return {
    id: row.id,
    district: row.district,
    fromLevel: row.from_level,
    toLevel: row.to_level,
    changedAt: row.changed_at,
    triggeredByIndicator: row.triggered_by_indicator,
    triggeredValue: row.triggered_value,
  };
}

function getLevelHistory(district, { limit = 100 } = {}) {
  return getDb()
    .prepare(`
      SELECT * FROM level_change_history
      WHERE district = ?
      ORDER BY id DESC
      LIMIT ?
    `)
    .all(district, limit)
    .map(mapHistory);
}

/* --------------------------------- 计数 --------------------------------- */

function countUsers() {
  return getDb().prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

module.exports = {
  mapUser,
  getUserByUsername,
  getUserById,
  getRawUserById,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  countUsers,
  listPipes,
  getPipeById,
  getPipeByCode,
  createPipe,
  updatePipe,
  deletePipe,
  listStations,
  getStationById,
  getStationByCode,
  createStation,
  updateStation,
  deleteStation,
  batchUpsertRainfall,
  getRainfallByRange,
  getRainfallForCalculation,
  listThresholds,
  getThresholdById,
  createThreshold,
  updateThreshold,
  deleteThreshold,
  getAllThresholdsRaw,
  getResponseLevelByDistrict,
  getAllResponseLevels,
  updateResponseLevelWithHistory,
  getLevelHistory,
};
