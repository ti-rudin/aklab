#!/usr/bin/env node
'use strict';

/**
 * Offline, schema-first, transactional multi-user migration.
 *
 * This command intentionally accepts an explicit SQLite path only. It never
 * loads Strapi, starts a server, or falls back to an implicit database path.
 *
 * Audit:
 *   node scripts/migrate-multiuser.js --db=/absolute/fixture.db --target-user-email=<email>
 * Apply:
 *   node scripts/migrate-multiuser.js --apply --db=/absolute/fixture.db \
 *     --target-user-email=<email> --backup=/absolute/before.db
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const PROPERTY_TYPES = Object.freeze([
  'office',
  'warehouse',
  'retail',
  'production',
  'free_purpose',
  'apartment',
  'land',
  'other',
]);
const REGIONS = Object.freeze(['moscow', 'mo', 'other']);
const PROPERTY_STATUSES = Object.freeze(['new', 'in_progress', 'viewed', 'rejected']);
const ADMIN_ROLE_TYPE = 'aklab_admin';

const REQUIRED_COLUMNS = Object.freeze({
  up_roles: ['id', 'name', 'type'],
  up_users: ['id', 'email', 'blocked'],
  setting: [
    'id',
    'monitored_regions',
    'price_from',
    'price_to',
    'area_from',
    'area_to',
    'stop_words',
    'smtp_to',
    'digest_enabled',
  ],
  properties: ['id', 'document_id', 'status'],
  user_profiles: [
    'id',
    'user_id',
    'regions',
    'property_types',
    'price_from',
    'price_to',
    'area_from',
    'area_to',
    'stop_words',
    'digest_email',
    'digest_enabled',
    'profile_version',
  ],
  user_property_states: ['id', 'user_id', 'property_document_id', 'identity_key', 'status'],
  user_comments: ['id'],
});

const RELATION_REQUIREMENTS = Object.freeze({
  profileUser: ['user_profiles', 'up_users'],
  stateUser: ['user_property_states', 'up_users'],
  stateProperty: ['user_property_states', 'properties'],
  commentProperty: ['user_comments', 'properties'],
  commentAuthor: ['user_comments', 'up_users'],
  userRole: ['up_users', 'up_roles'],
});

class MigrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new MigrationError(code, message);
}

function quoteIdentifier(identifier) {
  if (typeof identifier !== 'string' || identifier.length === 0) fail('SCHEMA_UNSUPPORTED', 'Invalid schema identifier');
  return `"${identifier.replaceAll('"', '""')}"`;
}

function tableRows(db) {
  return db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
}

function columnSet(db, table) {
  return new Set(tableColumns(db, table).map(column => column.name));
}

function foreignKeys(db, table) {
  return db.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`).all();
}

function uniqueColumns(db, table, requiredColumns) {
  const indexes = db.prepare(`PRAGMA index_list(${quoteIdentifier(table)})`).all();
  return indexes.some(index => {
    if (Number(index.unique) !== 1 || Number(index.partial) === 1) return false;
    const columns = db.prepare(`PRAGMA index_info(${quoteIdentifier(index.name)})`)
      .all()
      .sort((a, b) => a.seqno - b.seqno)
      .map(column => column.name);
    return columns.join('\u0000') === requiredColumns.join('\u0000');
  });
}

function normalizeEmail(value) {
  if (typeof value !== 'string') fail('INVALID_EMAIL', 'Target email is invalid');
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('INVALID_EMAIL', 'Target email is invalid');
  return email;
}

function normalizeStoredEmail(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function parseJsonArray(value, field, options = {}) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      fail('LEGACY_SETTING_INVALID', `Legacy ${field} is not valid JSON`);
    }
  }
  if (!Array.isArray(parsed)) fail('LEGACY_SETTING_INVALID', `Legacy ${field} must be an array`);
  if (parsed.some(item => typeof item !== 'string')) fail('LEGACY_SETTING_INVALID', `Legacy ${field} contains invalid values`);
  const normalized = [...new Set(parsed.map(item => item.trim().toLowerCase()).filter(Boolean))].sort();
  if (options.allowed && normalized.some(item => !options.allowed.includes(item))) {
    fail('LEGACY_SETTING_INVALID', `Legacy ${field} contains unsupported values`);
  }
  return normalized;
}

function parseOptionalNumber(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    value = value.trim();
    if (value === '') return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) fail('LEGACY_SETTING_INVALID', `Legacy ${field} is invalid`);
  return number;
}

function parseLegacyBoolean(value, field) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  fail('LEGACY_SETTING_INVALID', `Legacy ${field} is invalid`);
}

function parseSingleSmtp(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const raw = String(value).trim();
  const entries = raw.split(/[;,]/).map(entry => entry.trim()).filter(Boolean);
  if (entries.length !== 1) fail('LEGACY_SMTP_AMBIGUOUS', 'Legacy smtp_to is ambiguous');
  const normalized = normalizeStoredEmail(entries[0]);
  if (!normalized) fail('LEGACY_SMTP_INVALID', 'Legacy smtp_to is invalid');
  return normalized;
}

function describeSmtp(value) {
  if (value === null || value === undefined || String(value).trim() === '') return 'empty';
  const raw = String(value).trim();
  const entries = raw.split(/[;,]/).map(entry => entry.trim()).filter(Boolean);
  return entries.length === 1 && normalizeStoredEmail(entries[0]) ? 'valid_single' : 'invalid_or_ambiguous';
}

function resolveTargetUser(db, targetUserEmail) {
  const normalized = normalizeEmail(targetUserEmail);
  const rows = db.prepare('SELECT id, email FROM up_users ORDER BY id').all();
  const matches = rows.filter(row => normalizeStoredEmail(row.email) === normalized);
  if (matches.length !== 1) fail('TARGET_USER_RESOLUTION', 'Target user resolution failed');
  return matches[0].id;
}

function discoverRelation(db, sourceTable, targetTable) {
  // Strapi uses relation link tables such as user_profiles_user_links. We do
  // not guess their names: the link is accepted only when PRAGMA proves that
  // it has exactly one FK to each table, both targeting the primary key.
  const linkCandidates = [];
  for (const table of tableRows(db).map(row => row.name)) {
    if (table === sourceTable || table === targetTable) continue;
    const fks = foreignKeys(db, table);
    const sourceRefs = fks.filter(fk => fk.table === sourceTable && fk.to === 'id');
    const targetRefs = fks.filter(fk => fk.table === targetTable && fk.to === 'id');
    if (fks.length === 2 && sourceRefs.length === 1 && targetRefs.length === 1 && sourceRefs[0].from !== targetRefs[0].from) {
      const columns = columnSet(db, table);
      if (!columns.has('id') || !columns.has(sourceRefs[0].from) || !columns.has(targetRefs[0].from)) continue;
      linkCandidates.push({
        kind: 'link',
        table,
        sourceColumn: sourceRefs[0].from,
        targetColumn: targetRefs[0].from,
        targetTable,
      });
    }
  }
  if (linkCandidates.length > 1) fail('SCHEMA_AMBIGUOUS_RELATION', 'Multiple relation link tables detected');
  if (linkCandidates.length === 1) return linkCandidates[0];

  const directCandidates = foreignKeys(db, sourceTable)
    .filter(fk => fk.table === targetTable && fk.to === 'id');
  if (directCandidates.length === 1) {
    return {
      kind: 'direct',
      table: sourceTable,
      sourceColumn: 'id',
      targetColumn: directCandidates[0].from,
      targetTable,
    };
  }
  if (directCandidates.length > 1) fail('SCHEMA_AMBIGUOUS_RELATION', 'Multiple direct relation columns detected');
  fail('SCHEMA_UNSUPPORTED', 'Required relation is not introspectable');
}

function inspectSchema(db) {
  const tables = new Set(tableRows(db).map(row => row.name));
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    if (!tables.has(table)) fail('SCHEMA_UNSUPPORTED', 'Unsupported schema: required table is missing');
    const actual = columnSet(db, table);
    if (columns.some(column => !actual.has(column))) fail('SCHEMA_UNSUPPORTED', 'Unsupported schema: required column is missing');
  }
  if (!uniqueColumns(db, 'up_roles', ['type'])) fail('SCHEMA_UNSUPPORTED', 'Unsupported schema: role type uniqueness is missing');
  if (!uniqueColumns(db, 'properties', ['document_id'])) fail('SCHEMA_UNSUPPORTED', 'Unsupported schema: property document identity uniqueness is missing');
  if (!uniqueColumns(db, 'user_profiles', ['user_id'])) fail('SCHEMA_UNSUPPORTED', 'Unsupported schema: profile ownership uniqueness is missing');
  if (!uniqueColumns(db, 'user_property_states', ['identity_key'])) fail('SCHEMA_UNSUPPORTED', 'Unsupported schema: state identity uniqueness is missing');

  const relations = {};
  for (const [name, [source, target]] of Object.entries(RELATION_REQUIREMENTS)) {
    relations[name] = discoverRelation(db, source, target);
  }
  return { tables, relations };
}

function relationRows(db, relation, sourceId) {
  if (relation.kind === 'direct') {
    const row = db.prepare(`
      SELECT ${quoteIdentifier(relation.targetColumn)} AS target_id
      FROM ${quoteIdentifier(relation.table)}
      WHERE id = ?
    `).get(sourceId);
    if (!row || row.target_id === null || row.target_id === undefined) return [];
    return [{ targetId: row.target_id }];
  }
  return db.prepare(`
    SELECT ${quoteIdentifier(relation.targetColumn)} AS target_id
    FROM ${quoteIdentifier(relation.table)}
    WHERE ${quoteIdentifier(relation.sourceColumn)} = ?
    ORDER BY id ASC
  `).all(sourceId).map(row => ({ targetId: row.target_id }));
}

function singleRelationTarget(db, relation, sourceId, options = {}) {
  const rows = relationRows(db, relation, sourceId);
  if (rows.length > 1 && !options.allowMany) fail('DATA_RELATION_DRIFT', 'Relation has multiple targets');
  return rows.length === 1 ? rows[0].targetId : null;
}

function relationTargetExists(db, relation, targetId) {
  return Boolean(db.prepare(`
    SELECT 1 FROM ${quoteIdentifier(relation.targetTable)} WHERE id = ?
  `).get(targetId));
}

function relationDrift(db, schema) {
  const drift = [];
  const profileUser = schema.relations.profileUser;
  for (const row of db.prepare('SELECT id, user_id FROM user_profiles ORDER BY id').all()) {
    const userId = singleRelationTarget(db, profileUser, row.id);
    if (userId !== row.user_id || !relationTargetExists(db, profileUser, userId)) drift.push('profile');
  }

  const stateUser = schema.relations.stateUser;
  const stateProperty = schema.relations.stateProperty;
  for (const row of db.prepare('SELECT id, user_id, property_document_id FROM user_property_states ORDER BY id').all()) {
    const userId = singleRelationTarget(db, stateUser, row.id);
    const propertyId = singleRelationTarget(db, stateProperty, row.id);
    if (userId === null || !relationTargetExists(db, stateUser, userId)) drift.push('state');
    if (propertyId !== null && !relationTargetExists(db, stateProperty, propertyId)) drift.push('state');
    const property = propertyId === null ? null : db.prepare('SELECT document_id FROM properties WHERE id = ?').get(propertyId);
    if (userId !== row.user_id || !property || property.document_id !== row.property_document_id) drift.push('state');
  }

  const commentProperty = schema.relations.commentProperty;
  const commentAuthor = schema.relations.commentAuthor;
  for (const row of db.prepare('SELECT id FROM user_comments ORDER BY id').all()) {
    const propertyId = singleRelationTarget(db, commentProperty, row.id);
    if (propertyId === null || !relationTargetExists(db, commentProperty, propertyId)) drift.push('comment_property');
    const authorId = singleRelationTarget(db, commentAuthor, row.id);
    if (authorId !== null && !relationTargetExists(db, commentAuthor, authorId)) drift.push('comment_author');
  }
  if (drift.length > 0) fail('DATA_RELATION_DRIFT', 'Scalar ownership and relation links disagree');
}

function duplicateData(db) {
  const duplicateProfile = db.prepare(`
    SELECT 1 FROM user_profiles GROUP BY user_id HAVING COUNT(*) > 1 LIMIT 1
  `).get();
  const duplicateState = db.prepare(`
    SELECT 1 FROM user_property_states GROUP BY identity_key HAVING COUNT(*) > 1 LIMIT 1
  `).get();
  const duplicateRole = db.prepare(`
    SELECT 1 FROM up_roles WHERE type = ? GROUP BY type HAVING COUNT(*) > 1 LIMIT 1
  `).get(ADMIN_ROLE_TYPE);
  if (duplicateProfile || duplicateState || duplicateRole) fail('DATA_DUPLICATE', 'Duplicate migration identity detected');
}

function commentsWithoutAuthor(db, relation) {
  let count = 0;
  for (const row of db.prepare('SELECT id FROM user_comments').all()) {
    if (singleRelationTarget(db, relation, row.id) === null) count += 1;
  }
  return count;
}

function roleReport(db, schema) {
  const roles = db.prepare('SELECT id FROM up_roles WHERE type = ? ORDER BY id').all(ADMIN_ROLE_TYPE);
  if (roles.length > 1) fail('DATA_DUPLICATE', 'Duplicate admin role detected');
  if (roles.length === 0) return { present: false, assigned_users: 0 };
  const roleId = roles[0].id;
  let assignedUsers;
  const relation = schema.relations.userRole;
  if (relation.kind === 'direct') {
    assignedUsers = db.prepare(`
      SELECT COUNT(*) AS count FROM up_users WHERE ${quoteIdentifier(relation.targetColumn)} = ?
    `).get(roleId).count;
  } else {
    assignedUsers = db.prepare(`
      SELECT COUNT(DISTINCT ${quoteIdentifier(relation.sourceColumn)}) AS count
      FROM ${quoteIdentifier(relation.table)}
      WHERE ${quoteIdentifier(relation.targetColumn)} = ?
    `).get(roleId).count;
  }
  return { present: true, assigned_users: assignedUsers };
}

function readSetting(db) {
  const rows = db.prepare('SELECT * FROM setting ORDER BY id').all();
  if (rows.length !== 1) fail('LEGACY_SETTING_INVALID', 'Legacy Setting is not a singleton');
  return rows[0];
}

function auditDatabase(db, targetUserEmail) {
  const schema = inspectSchema(db);
  duplicateData(db);
  relationDrift(db, schema);
  const targetUserId = resolveTargetUser(db, targetUserEmail);
  const setting = readSetting(db);
  const statusCounts = Object.fromEntries(PROPERTY_STATUSES.map(status => [status, 0]));
  const propertyDocuments = new Set();
  for (const row of db.prepare('SELECT document_id, status FROM properties ORDER BY id').all()) {
    if (typeof row.document_id !== 'string' || row.document_id.trim() === '' || propertyDocuments.has(row.document_id)) {
      fail('DATA_INVALID_PROPERTY', 'Legacy property identity is invalid');
    }
    propertyDocuments.add(row.document_id);
    if (!PROPERTY_STATUSES.includes(row.status)) fail('DATA_INVALID_STATUS', 'Legacy property status is invalid');
    statusCounts[row.status] += 1;
  }

  const profileCount = db.prepare('SELECT COUNT(*) AS count FROM user_profiles').get().count;
  const stateCount = db.prepare('SELECT COUNT(*) AS count FROM user_property_states').get().count;
  const report = {
    mode: 'audit',
    schema: {
      ready: true,
      relations: Object.fromEntries(Object.entries(schema.relations).map(([name, relation]) => [name, relation.kind])),
      unique_constraints: {
        role_type: true,
        property_document_id: true,
        profile_user_id: true,
        state_identity_key: true,
      },
    },
    counts: {
      users: db.prepare('SELECT COUNT(*) AS count FROM up_users').get().count,
      properties_by_status: statusCounts,
      comments_without_author: commentsWithoutAuthor(db, schema.relations.commentAuthor),
      profiles: profileCount,
      states: stateCount,
      aklab_admin_role: roleReport(db, schema),
    },
  };
  // Keep the resolved ID private to callers that need to apply the plan. It is
  // deliberately non-enumerable so JSON machine output remains count-only.
  Object.defineProperty(report, '_targetUserId', { value: targetUserId, enumerable: false });
  Object.defineProperty(report, '_schema', { value: schema, enumerable: false });
  return report;
}

function migrationProfileFromSetting(setting) {
  const digestEmail = parseSingleSmtp(setting.smtp_to);
  const priceFrom = parseOptionalNumber(setting.price_from, 'price_from');
  const priceTo = parseOptionalNumber(setting.price_to, 'price_to');
  const areaFrom = parseOptionalNumber(setting.area_from, 'area_from');
  const areaTo = parseOptionalNumber(setting.area_to, 'area_to');
  const digestEnabled = parseLegacyBoolean(setting.digest_enabled, 'digest_enabled');
  if (priceFrom !== null && priceTo !== null && priceFrom > priceTo) {
    fail('LEGACY_SETTING_INVALID', 'Legacy price range is inverted');
  }
  if (areaFrom !== null && areaTo !== null && areaFrom > areaTo) {
    fail('LEGACY_SETTING_INVALID', 'Legacy area range is inverted');
  }
  return {
    regions: parseJsonArray(setting.monitored_regions, 'monitored_regions', { allowed: REGIONS }),
    property_types: PROPERTY_TYPES.slice(),
    price_from: priceFrom,
    price_to: priceTo,
    area_from: areaFrom,
    area_to: areaTo,
    stop_words: parseJsonArray(setting.stop_words, 'stop_words'),
    digest_email: digestEmail,
    digest_enabled: digestEnabled && Boolean(digestEmail),
    profile_version: 1,
  };
}

function broadProfile() {
  return {
    regions: REGIONS.slice(),
    property_types: PROPERTY_TYPES.slice(),
    price_from: null,
    price_to: null,
    area_from: null,
    area_to: null,
    stop_words: [],
    digest_email: null,
    digest_enabled: false,
    profile_version: 1,
  };
}

function serializedProfile(value) {
  return JSON.stringify(value);
}

function profileContractMatches(row, userId, contract) {
  if (!row || row.user_id !== userId) return false;
  for (const field of ['regions', 'property_types', 'stop_words']) {
    if (serializedProfile(parseJsonArray(row[field], field)) !== serializedProfile(contract[field])) return false;
  }
  for (const field of ['price_from', 'price_to', 'area_from', 'area_to']) {
    if ((row[field] === null ? null : Number(row[field])) !== contract[field]) return false;
  }
  if (normalizeStoredEmail(row.digest_email) !== contract.digest_email) return false;
  if (Boolean(row.digest_enabled) !== contract.digest_enabled) return false;
  return Number(row.profile_version) === contract.profile_version;
}

function insertRow(db, table, values) {
  const columns = columnSet(db, table);
  const entries = Object.entries(values).filter(([column]) => columns.has(column));
  const names = entries.map(([column]) => quoteIdentifier(column)).join(', ');
  const placeholders = entries.map(() => '?').join(', ');
  const result = db.prepare(`INSERT INTO ${quoteIdentifier(table)} (${names}) VALUES (${placeholders})`)
    .run(...entries.map(([, value]) => value));
  return Number(result.lastInsertRowid);
}

function ensureRelation(db, relation, sourceId, targetId, options = {}) {
  const rows = relationRows(db, relation, sourceId);
  if (rows.some(row => row.targetId === targetId)) return false;
  if (rows.length > 0 && options.replaceExisting) {
    if (rows.length !== 1) fail('DATA_RELATION_DRIFT', 'Relation has multiple targets');
    if (relation.kind === 'direct') {
      db.prepare(`UPDATE ${quoteIdentifier(relation.table)} SET ${quoteIdentifier(relation.targetColumn)} = ? WHERE id = ?`)
        .run(targetId, sourceId);
    } else {
      db.prepare(`UPDATE ${quoteIdentifier(relation.table)} SET ${quoteIdentifier(relation.targetColumn)} = ? WHERE ${quoteIdentifier(relation.sourceColumn)} = ?`)
        .run(targetId, sourceId);
    }
    return true;
  }
  if (rows.length > 0) {
    fail('DATA_RELATION_DRIFT', 'Relation already points elsewhere');
  }
  if (relation.kind === 'direct') {
    db.prepare(`UPDATE ${quoteIdentifier(relation.table)} SET ${quoteIdentifier(relation.targetColumn)} = ? WHERE id = ?`)
      .run(targetId, sourceId);
  } else {
    const columns = columnSet(db, relation.table);
    const values = {
      [relation.sourceColumn]: sourceId,
      [relation.targetColumn]: targetId,
    };
    if (columns.has('created_at')) values.created_at = new Date().toISOString();
    if (columns.has('updated_at')) values.updated_at = new Date().toISOString();
    insertRow(db, relation.table, values);
  }
  return true;
}

function getRoleId(db) {
  const row = db.prepare('SELECT id FROM up_roles WHERE type = ?').get(ADMIN_ROLE_TYPE);
  return row ? row.id : null;
}

function ensureAdminRole(db) {
  const existing = getRoleId(db);
  if (existing !== null) return { roleId: existing, created: 0 };
  const roleId = insertRow(db, 'up_roles', {
    name: 'AKLAB Admin',
    description: 'AKLAB administrator role for authorized application operations.',
    type: ADMIN_ROLE_TYPE,
  });
  return { roleId, created: 1 };
}

function ensureProfile(db, schema, userId, contract) {
  const existing = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId);
  if (existing) {
    // Existing user-authored content is authoritative. A profile that exactly
    // matches the migration contract is already complete and is left untouched.
    if (!profileContractMatches(existing, userId, contract)) return { created: 0, preserved: 1 };
    return { created: 0, preserved: 0 };
  }
  const profileId = insertRow(db, 'user_profiles', {
    user_id: userId,
    regions: JSON.stringify(contract.regions),
    property_types: JSON.stringify(contract.property_types),
    price_from: contract.price_from,
    price_to: contract.price_to,
    area_from: contract.area_from,
    area_to: contract.area_to,
    stop_words: JSON.stringify(contract.stop_words),
    digest_email: contract.digest_email,
    digest_enabled: contract.digest_enabled ? 1 : 0,
    profile_version: contract.profile_version,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  ensureRelation(db, schema.relations.profileUser, profileId, userId);
  return { created: 1, preserved: 0 };
}

function ensureState(db, schema, userId, property) {
  const identityKey = `${userId}:${property.document_id}`;
  const existing = db.prepare('SELECT * FROM user_property_states WHERE identity_key = ?').get(identityKey);
  if (existing) {
    if (existing.user_id !== userId || existing.property_document_id !== property.document_id) {
      fail('DATA_RELATION_DRIFT', 'Existing state identity disagrees with scalar ownership');
    }
    ensureRelation(db, schema.relations.stateUser, existing.id, userId);
    ensureRelation(db, schema.relations.stateProperty, existing.id, property.id);
    return 0;
  }
  const stateId = insertRow(db, 'user_property_states', {
    user_id: userId,
    property_document_id: property.document_id,
    identity_key: identityKey,
    status: property.status,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  ensureRelation(db, schema.relations.stateUser, stateId, userId);
  ensureRelation(db, schema.relations.stateProperty, stateId, property.id);
  return 1;
}

function ensureCommentAuthors(db, schema, targetUserId) {
  let authored = 0;
  for (const comment of db.prepare('SELECT id FROM user_comments ORDER BY id').all()) {
    const authorId = singleRelationTarget(db, schema.relations.commentAuthor, comment.id);
    if (authorId === null) {
      if (ensureRelation(db, schema.relations.commentAuthor, comment.id, targetUserId)) authored += 1;
    }
  }
  return authored;
}

function applyChanges(db, schema, targetUserId, setting, options) {
  const targetContract = options.targetContract || migrationProfileFromSetting(setting);
  let profilesCreated = 0;
  let profilesPreserved = 0;
  const targetProfile = ensureProfile(db, schema, targetUserId, targetContract);
  profilesCreated += targetProfile.created;
  profilesPreserved += targetProfile.preserved;

  for (const user of db.prepare('SELECT id FROM up_users WHERE id != ? ORDER BY id').all(targetUserId)) {
    const result = ensureProfile(db, schema, user.id, broadProfile());
    profilesCreated += result.created;
    profilesPreserved += result.preserved;
  }
  if (options.failAfter === 'profiles') fail('INJECTED_FAILURE', 'Injected failure after profiles');

  let statesCreated = 0;
  for (const property of db.prepare(`
    SELECT id, document_id, status FROM properties WHERE status IS NOT NULL AND status <> 'new' ORDER BY id
  `).all()) {
    statesCreated += ensureState(db, schema, targetUserId, property);
  }
  if (options.failAfter === 'states') fail('INJECTED_FAILURE', 'Injected failure after states');

  const commentsAuthored = ensureCommentAuthors(db, schema, targetUserId);
  if (options.failAfter === 'comments') fail('INJECTED_FAILURE', 'Injected failure after comments');

  const role = ensureAdminRole(db);
  const roleAssigned = ensureRelation(
    db,
    schema.relations.userRole,
    targetUserId,
    role.roleId,
    { replaceExisting: true },
  ) ? 1 : 0;
  if (options.failAfter === 'role') fail('INJECTED_FAILURE', 'Injected failure after role');

  return {
    changes: {
      profiles_created: profilesCreated,
      states_created: statesCreated,
      comments_authored: commentsAuthored,
      role_created: role.created,
      role_assigned: roleAssigned,
    },
    profiles_preserved: profilesPreserved,
  };
}

function backupDatabase(db, dbPath, backupPath) {
  if (!path.isAbsolute(backupPath)) fail('BACKUP_INVALID', 'Backup path must be absolute');
  const resolvedDb = path.resolve(dbPath);
  const resolvedBackup = path.resolve(backupPath);
  if (resolvedDb === resolvedBackup) fail('BACKUP_INVALID', 'Backup path must differ from database path');
  if (!fs.existsSync(resolvedDb) || !fs.statSync(resolvedDb).isFile()) fail('DB_INVALID', 'SQLite database path is not a file');
  const parent = path.dirname(resolvedBackup);
  if (!fs.existsSync(parent)) fail('BACKUP_INVALID', 'Backup parent directory does not exist');
  try {
    fs.lstatSync(resolvedBackup);
    fail('BACKUP_INVALID', 'Backup path already exists');
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    if (error.code !== 'ENOENT') fail('BACKUP_INVALID', 'Backup path cannot be inspected');
  }

  // VACUUM INTO creates a transaction-consistent snapshot, including data that
  // is currently in a WAL. A raw file copy would silently omit that data.
  db.prepare('VACUUM main INTO ?').run(resolvedBackup);
  if (!fs.existsSync(resolvedBackup) || !fs.statSync(resolvedBackup).isFile()) {
    fail('BACKUP_INVALID', 'Backup file was not created');
  }
  fs.chmodSync(resolvedBackup, 0o600);
  const backupBytes = fs.statSync(resolvedBackup).size;
  const backupHash = sha256File(resolvedBackup);

  const backupDb = new Database(resolvedBackup, { readonly: true, fileMustExist: true });
  try {
    const integrity = backupDb.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') fail('BACKUP_INVALID', 'Backup integrity verification failed');
  } finally {
    backupDb.close();
  }
  return { bytes: backupBytes, sha256: backupHash, integrity: 'ok' };
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function applyMigration({ dbPath, targetUserEmail, backupPath, failAfter = null }) {
  if (!path.isAbsolute(dbPath)) fail('DB_INVALID', 'Database path must be absolute');
  if (!path.isAbsolute(backupPath)) fail('BACKUP_INVALID', 'Backup path must be absolute');
  const db = new Database(dbPath, { fileMustExist: true });
  let transactionStarted = false;
  try {
    const before = auditDatabase(db, targetUserEmail);
    const setting = readSetting(db);
    // Validate and canonicalize all legacy values before creating any backup
    // or entering the write transaction. Invalid SMTP lists therefore fail
    // with zero filesystem and database side effects.
    const targetContract = migrationProfileFromSetting(setting);
    const backup = backupDatabase(db, dbPath, backupPath);

    db.exec('BEGIN IMMEDIATE');
    transactionStarted = true;
    const schema = before._schema;
    const applied = applyChanges(db, schema, before._targetUserId, setting, { failAfter, targetContract });
    // Verify the uncommitted state so any postcondition failure is still
    // covered by the transaction's rollback path.
    const after = auditDatabase(db, targetUserEmail);
    db.exec('COMMIT');
    transactionStarted = false;

    return {
      mode: 'migrate',
      before,
      after,
      changes: applied.changes,
      profiles_preserved: applied.profiles_preserved,
      backup,
      // Kept for tests/callers, but main() removes internal identifiers before
      // serializing the machine-readable CLI result.
      targetUserId: before._targetUserId,
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Preserve the original migration error.
      }
    }
    throw error;
  } finally {
    db.close();
  }
}

function parseArgs(argv) {
  const options = { apply: false, dbPath: null, backupPath: null, targetUserEmail: null, failAfter: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--db') options.dbPath = argv[++index] || null;
    else if (arg.startsWith('--db=')) options.dbPath = arg.slice('--db='.length);
    else if (arg === '--backup') options.backupPath = argv[++index] || null;
    else if (arg.startsWith('--backup=')) options.backupPath = arg.slice('--backup='.length);
    else if (arg === '--target-user-email') options.targetUserEmail = argv[++index] || null;
    else if (arg.startsWith('--target-user-email=')) options.targetUserEmail = arg.slice('--target-user-email='.length);
    else if (arg === '--fail-after') options.failAfter = argv[++index] || null;
    else if (arg.startsWith('--fail-after=')) options.failAfter = arg.slice('--fail-after='.length);
    else if (arg === '--help' || arg === '-h') return { ...options, help: true };
    else fail('CLI_ARGUMENTS', 'Unknown CLI argument');
  }
  if (options.help) return options;
  if (!options.dbPath || !options.targetUserEmail) fail('CLI_ARGUMENTS', 'Explicit --db and --target-user-email are required');
  if (!path.isAbsolute(options.dbPath)) fail('CLI_ARGUMENTS', 'Database path must be absolute');
  if (options.backupPath !== null && !path.isAbsolute(options.backupPath)) {
    fail('CLI_ARGUMENTS', 'Backup path must be absolute');
  }
  if (options.apply) {
    if (!options.backupPath) fail('CLI_ARGUMENTS', 'Apply requires an absolute --backup path');
  }
  return options;
}

function publicReport(value) {
  if (!value || typeof value !== 'object') return value;
  const copy = Array.isArray(value) ? value.map(publicReport) : { ...value };
  if (!Array.isArray(copy)) {
    delete copy._targetUserId;
    delete copy._schema;
    delete copy.targetUserId;
  }
  return Object.fromEntries(Object.entries(copy).map(([key, item]) => [key, publicReport(item)]));
}

function usage() {
  return [
    'Usage:',
    '  npm run multiuser:audit -- --target-user-email=<email> --db=/absolute/path.db',
    '  npm run multiuser:migrate -- --target-user-email=<email> --db=/absolute/path.db --backup=/absolute/before.db',
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.apply) {
    console.log(JSON.stringify(publicReport(applyMigration(options)), null, 2));
    return;
  }
  const db = new Database(options.dbPath, { readonly: true, fileMustExist: true });
  try {
    console.log(JSON.stringify(publicReport(auditDatabase(db, options.targetUserEmail)), null, 2));
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    const code = error && typeof error.code === 'string' ? error.code : 'MIGRATION_FAILED';
    console.error(JSON.stringify({ ok: false, error: code }));
    process.exitCode = 1;
  }
}

module.exports = {
  ADMIN_ROLE_TYPE,
  PROPERTY_TYPES,
  REGIONS,
  applyMigration,
  auditDatabase,
  discoverRelation,
  inspectSchema,
  main,
  normalizeEmail,
  parseArgs,
  publicReport,
};
