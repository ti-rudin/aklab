import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROPERTY_TYPE_VALUES } from '@aklab/parse-rules';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyMigration, auditDatabase, parseArgs } from '../migrate-multiuser.js';

const TARGET_EMAIL = 'Primary@Example.test';

let tempDir = '';
let dbPath = '';
let db: any = null;

function createFixture() {
  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  // Strapi 5.51.2 derives relation tables as *_links and stores the owning
  // and inverse relation IDs in the corresponding *_id columns. This fixture
  // models that physical direction, not only the content-type JSON. Residual
  // risk: a real target DB must still pass the CLI's PRAGMA-based audit before
  // apply; this synthetic fixture cannot prove every deployed DB variation.
  db.exec(`
    CREATE TABLE up_roles (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT UNIQUE
    );
    CREATE TABLE up_users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      blocked INTEGER DEFAULT 0,
      confirmed INTEGER DEFAULT 0
    );
    CREATE TABLE setting (
      id INTEGER PRIMARY KEY,
      monitored_regions TEXT,
      price_from REAL,
      price_to REAL,
      area_from REAL,
      area_to REAL,
      stop_words TEXT,
      smtp_to TEXT,
      digest_enabled INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE up_users_role_links (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES up_users(id),
      role_id INTEGER NOT NULL REFERENCES up_roles(id),
      UNIQUE(user_id, role_id)
    );
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY,
      document_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL
    );
    CREATE TABLE user_profiles (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE,
      regions TEXT NOT NULL,
      property_types TEXT NOT NULL,
      price_from REAL,
      price_to REAL,
      area_from REAL,
      area_to REAL,
      stop_words TEXT NOT NULL,
      digest_email TEXT,
      digest_enabled INTEGER NOT NULL,
      profile_version INTEGER NOT NULL
    );
    CREATE TABLE user_profiles_user_links (
      id INTEGER PRIMARY KEY,
      user_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
      user_id INTEGER NOT NULL REFERENCES up_users(id),
      user_order REAL,
      UNIQUE(user_profile_id, user_id)
    );
    CREATE TABLE user_property_states (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      property_document_id TEXT NOT NULL,
      identity_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL
    );
    CREATE TABLE user_property_states_user_links (
      id INTEGER PRIMARY KEY,
      user_property_state_id INTEGER NOT NULL REFERENCES user_property_states(id),
      user_id INTEGER NOT NULL REFERENCES up_users(id),
      UNIQUE(user_property_state_id, user_id)
    );
    CREATE TABLE user_property_states_property_links (
      id INTEGER PRIMARY KEY,
      user_property_state_id INTEGER NOT NULL REFERENCES user_property_states(id),
      property_id INTEGER NOT NULL REFERENCES properties(id),
      UNIQUE(user_property_state_id, property_id)
    );
    CREATE TABLE user_comments (
      id INTEGER PRIMARY KEY,
      text TEXT NOT NULL
    );
    CREATE TABLE user_comments_property_links (
      id INTEGER PRIMARY KEY,
      user_comment_id INTEGER NOT NULL REFERENCES user_comments(id),
      property_id INTEGER NOT NULL REFERENCES properties(id),
      UNIQUE(user_comment_id, property_id)
    );
    CREATE TABLE user_comments_author_links (
      id INTEGER PRIMARY KEY,
      user_comment_id INTEGER NOT NULL REFERENCES user_comments(id),
      user_id INTEGER NOT NULL REFERENCES up_users(id),
      UNIQUE(user_comment_id, user_id)
    );
  `);

  db.exec(`
    INSERT INTO up_roles (id, name, description, type) VALUES
      (1, 'Authenticated', 'regular', 'authenticated'),
      (2, 'Other', 'other role', 'other_role');
    INSERT INTO up_users (id, username, email, blocked, confirmed) VALUES
      (1, 'primary', 'Primary@Example.test', 0, 1),
      (2, 'existing', 'existing@example.test', 0, 1),
      (3, 'new-user', 'new-user@example.test', 0, 1);
    INSERT INTO up_users_role_links (user_id, role_id) VALUES
      (1, 1), (2, 2), (3, 1);
    INSERT INTO setting
      (id, monitored_regions, price_from, price_to, area_from, area_to, stop_words, smtp_to, digest_enabled)
      VALUES
      (1, '["moscow","mo"]', 1000000, 20000000, 10, 500,
       '["земельный участок","участок"]', ' Digest@Example.COM ', 1);
    INSERT INTO properties (id, document_id, status) VALUES
      (1, 'p-new', 'new'),
      (2, 'p-progress', 'in_progress'),
      (3, 'p-viewed', 'viewed'),
      (4, 'p-rejected', 'rejected');
    INSERT INTO user_profiles
      (id, user_id, regions, property_types, price_from, price_to, area_from, area_to,
       stop_words, digest_email, digest_enabled, profile_version)
      VALUES
      (1, 2, '["other"]', '["land"]', NULL, NULL, NULL, NULL, '["custom"]', NULL, 0, 7);
    INSERT INTO user_profiles_user_links (user_profile_id, user_id) VALUES (1, 2);
    INSERT INTO user_comments (id, text) VALUES
      (1, 'missing author'),
      (2, 'existing author');
    INSERT INTO user_comments_property_links (user_comment_id, property_id) VALUES
      (1, 2), (2, 3);
    INSERT INTO user_comments_author_links (user_comment_id, user_id) VALUES
      (2, 2);
  `);
}

function snapshotBytes(filePath = dbPath) {
  return fs.readFileSync(filePath);
}

function backupSummary(filePath: string) {
  const backupDb = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    return {
      integrity: backupDb.pragma('integrity_check', { simple: true }),
      profiles: (backupDb.prepare('SELECT COUNT(*) AS count FROM user_profiles').get() as any).count,
      commentAuthors: (backupDb.prepare('SELECT COUNT(*) AS count FROM user_comments_author_links').get() as any).count,
    };
  } finally {
    backupDb.close();
  }
}

function scalar(sql: string, ...params: unknown[]): any {
  return db.prepare(sql).get(...params);
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aklab-multiuser-'));
  dbPath = path.join(tempDir, 'fixture.db');
  createFixture();
});

afterEach(() => {
  if (db) db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('migrate-multiuser offline CLI', () => {
  it('audits a realistic fixture read-only and emits counts without PII', () => {
    const before = snapshotBytes();

    const report = auditDatabase(db, TARGET_EMAIL);

    expect(report.schema.ready).toBe(true);
    expect(report.counts.users).toBe(3);
    expect(report.counts.properties_by_status).toEqual({
      new: 1,
      in_progress: 1,
      viewed: 1,
      rejected: 1,
    });
    expect(report.counts.comments_without_author).toBe(1);
    expect(report.counts.profiles).toBe(1);
    expect(report.counts.states).toBe(0);
    expect(report.counts.aklab_admin_role.present).toBe(false);
    expect(report.counts.aklab_admin_role.assigned_users).toBe(0);
    expect(JSON.stringify(report)).not.toContain(TARGET_EMAIL.toLowerCase());
    expect(snapshotBytes()).toEqual(before);
  });

  it('requires explicit absolute database and backup paths', () => {
    expect(() => parseArgs([
      '--db=relative.db',
      `--target-user-email=${TARGET_EMAIL}`,
    ])).toThrow(/absolute/i);
    expect(() => parseArgs([
      '--apply',
      `--db=${dbPath}`,
      '--backup=relative-before.db',
      `--target-user-email=${TARGET_EMAIL}`,
    ])).toThrow(/absolute/i);
  });

  it('applies the migration with scalar ownership and inspected relation links', () => {
    const boundedStopWords = [
      ` ${'X'.repeat(256)} `,
      ...Array.from({ length: 127 }, (_, index) => ` bounded-${index} `),
    ];
    db.prepare('UPDATE setting SET stop_words = ?').run(JSON.stringify(boundedStopWords));
    const backupPath = path.join(tempDir, 'before.db');

    const result = applyMigration({ dbPath, targetUserEmail: TARGET_EMAIL, backupPath });

    expect(result.before.counts.comments_without_author).toBe(1);
    expect(backupSummary(backupPath)).toEqual({ integrity: 'ok', profiles: 1, commentAuthors: 1 });
    expect(result.after.counts.comments_without_author).toBe(0);
    expect(result.after.counts.profiles).toBe(3);
    expect(result.after.counts.states).toBe(3);
    expect(result.after.counts.aklab_admin_role.present).toBe(true);
    expect(result.after.counts.aklab_admin_role.assigned_users).toBe(1);
    expect(result.changes).toMatchObject({ profiles_created: 2, states_created: 3, comments_authored: 1 });
    expect(scalar('SELECT role_id FROM up_users_role_links WHERE user_id = 1').role_id).toBe(3);
    expect(scalar('SELECT type FROM up_roles WHERE id = 3').type).toBe('aklab_admin');
    expect(scalar('SELECT COUNT(*) AS count FROM up_users_role_links WHERE user_id = 1').count).toBe(1);

    const profile = db.prepare('SELECT * FROM user_profiles WHERE user_id = 1').get();
    expect(JSON.parse(profile.regions)).toEqual(['mo', 'moscow']);
    expect(JSON.parse(profile.property_types)).toEqual([...PROPERTY_TYPE_VALUES].sort());
    expect(JSON.parse(profile.stop_words)).toHaveLength(128);
    expect(JSON.parse(profile.stop_words)).toContain('x'.repeat(256));
    expect(profile.digest_email).toBe('digest@example.com');
    expect(profile.digest_enabled).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM user_profiles_user_links WHERE user_id = 1').get().count).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM user_property_states_user_links').get().count).toBe(3);
    expect(db.prepare('SELECT COUNT(*) AS count FROM user_property_states_property_links').get().count).toBe(3);
    expect(db.prepare('SELECT COUNT(*) AS count FROM user_comments_author_links WHERE user_id = 1').get().count).toBe(1);
    expect(scalar('SELECT COUNT(*) AS count FROM properties WHERE status != \'new\'').count).toBe(3);
    expect(scalar('SELECT COUNT(*) AS count FROM setting').count).toBe(1);
    expect(scalar('SELECT COUNT(*) AS count FROM user_comments').count).toBe(2);
    expect(scalar('SELECT COUNT(*) AS count FROM user_comments_author_links WHERE user_id = 2').count).toBe(1);
    expect(scalar('SELECT role_id FROM up_users_role_links WHERE user_id = 2').role_id).toBe(2);
  });

  it('is idempotent and preserves an existing non-migration profile', () => {
    const backupPath = path.join(tempDir, 'before.db');
    applyMigration({ dbPath, targetUserEmail: TARGET_EMAIL, backupPath });
    const profileBefore = db.prepare('SELECT * FROM user_profiles WHERE user_id = 2').get();
    const stateCountBefore = scalar('SELECT COUNT(*) AS count FROM user_property_states').count;
    const commentCountBefore = scalar('SELECT COUNT(*) AS count FROM user_comments_author_links').count;

    const second = applyMigration({
      dbPath,
      targetUserEmail: TARGET_EMAIL,
      backupPath: path.join(tempDir, 'before-second.db'),
    });

    expect(second.changes).toEqual({ profiles_created: 0, states_created: 0, comments_authored: 0, role_created: 0, role_assigned: 0 });
    expect(db.prepare('SELECT * FROM user_profiles WHERE user_id = 2').get()).toEqual(profileBefore);
    expect(scalar('SELECT COUNT(*) AS count FROM user_property_states').count).toBe(stateCountBefore);
    expect(scalar('SELECT COUNT(*) AS count FROM user_comments_author_links').count).toBe(commentCountBefore);
  });

  it('maps a string false legacy digest flag to disabled', () => {
    db.prepare('UPDATE setting SET digest_enabled = ?').run('0');
    const backupPath = path.join(tempDir, 'string-false-before.db');

    applyMigration({ dbPath, targetUserEmail: TARGET_EMAIL, backupPath });

    expect(scalar('SELECT digest_enabled FROM user_profiles WHERE user_id = 1').digest_enabled).toBe(0);
  });

  it('rejects inverted legacy ranges before creating a backup', () => {
    db.prepare('UPDATE setting SET price_from = ?, price_to = ?').run(20, 10);
    const before = snapshotBytes();
    const backupPath = path.join(tempDir, 'inverted-range-before.db');

    expect(() => applyMigration({ dbPath, targetUserEmail: TARGET_EMAIL, backupPath }))
      .toThrow('Legacy setting is invalid');

    expect(snapshotBytes()).toEqual(before);
    expect(fs.existsSync(backupPath)).toBe(false);
  });

  it('rejects an unknown legacy property status before creating a state', () => {
    db.prepare('UPDATE properties SET status = ? WHERE id = 2').run('archived');
    const before = snapshotBytes();
    const backupPath = path.join(tempDir, 'invalid-status-before.db');

    expect(() => applyMigration({ dbPath, targetUserEmail: TARGET_EMAIL, backupPath })).toThrow(/status/i);

    expect(snapshotBytes()).toEqual(before);
    expect(fs.existsSync(backupPath)).toBe(false);
  });

  it('fails closed when a relation foreign key does not reference the target primary key', () => {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      DROP TABLE user_profiles_user_links;
      CREATE TABLE user_profiles_user_links (
        id INTEGER PRIMARY KEY,
        user_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
        user_id INTEGER NOT NULL REFERENCES up_users(username),
        UNIQUE(user_profile_id, user_id)
      );
      INSERT INTO user_profiles_user_links (user_profile_id, user_id) VALUES (1, 2);
    `);
    const before = snapshotBytes();

    expect(() => auditDatabase(db, TARGET_EMAIL)).toThrow(/schema|introspectable/i);

    expect(snapshotBytes()).toEqual(before);
  });

  it('rolls back every database change after an injected failure or postcondition violation', () => {
    const before = snapshotBytes();
    const backupPath = path.join(tempDir, 'rollback-before.db');

    expect(() => applyMigration({
      dbPath,
      targetUserEmail: TARGET_EMAIL,
      backupPath,
      failAfter: 'comments',
    } as any)).toThrow(/injected/i);

    expect(snapshotBytes()).toEqual(before);
    expect(scalar('SELECT COUNT(*) AS count FROM user_profiles').count).toBe(1);
    expect(scalar('SELECT COUNT(*) AS count FROM user_comments_author_links').count).toBe(1);
    expect(backupSummary(backupPath)).toEqual({ integrity: 'ok', profiles: 1, commentAuthors: 1 });

    const profileCases = [
      { name: 'malformed', regions: '["unsupported"]', propertyTypes: '["office"]' },
      { name: 'not-ready', regions: '[]', propertyTypes: '["office"]' },
    ];
    for (const testCase of profileCases) {
      db.prepare('UPDATE user_profiles SET regions = ?, property_types = ? WHERE user_id = 2')
        .run(testCase.regions, testCase.propertyTypes);
      const profileBefore = snapshotBytes();
      const profileBackup = path.join(tempDir, `${testCase.name}-rollback.db`);
      let error: unknown;
      try {
        applyMigration({ dbPath, targetUserEmail: TARGET_EMAIL, backupPath: profileBackup });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeTruthy();
      expect(String(error)).toMatch(/postcondition/i);
      expect(String(error)).not.toContain('unsupported');
      expect(snapshotBytes()).toEqual(profileBefore);
      expect(backupSummary(profileBackup)).toEqual({ integrity: 'ok', profiles: 1, commentAuthors: 1 });
      db.prepare('UPDATE user_profiles SET regions = ?, property_types = ? WHERE user_id = 2')
        .run('["other"]', '["land"]');
    }
  });

  it('fails closed on malformed legacy settings before writing', () => {
    const cases = [
      {
        name: 'ambiguous-smtp',
        mutate: () => db.prepare('UPDATE setting SET smtp_to = ?').run('one@example.com, two@example.com'),
        restore: () => db.prepare('UPDATE setting SET smtp_to = ?').run(' Digest@Example.COM '),
      },
      {
        name: 'canonical-129',
        mutate: () => db.prepare('UPDATE setting SET stop_words = ?')
          .run(JSON.stringify(Array.from({ length: 129 }, (_, index) => `word-${index}`))),
        restore: () => db.prepare('UPDATE setting SET stop_words = ?')
          .run('["земельный участок","участок"]'),
      },
      {
        name: 'canonical-257',
        mutate: () => db.prepare('UPDATE setting SET stop_words = ?').run(JSON.stringify(['x'.repeat(257)])),
        restore: () => db.prepare('UPDATE setting SET stop_words = ?')
          .run('["земельный участок","участок"]'),
      },
      {
        name: 'empty-regions',
        mutate: () => db.prepare('UPDATE setting SET monitored_regions = ?').run('[]'),
        restore: () => db.prepare('UPDATE setting SET monitored_regions = ?').run('["moscow","mo"]'),
      },
    ];

    for (const testCase of cases) {
      testCase.mutate();
      const before = snapshotBytes();
      const backupPath = path.join(tempDir, `${testCase.name}-before.db`);
      let error: unknown;
      try {
        applyMigration({ dbPath, targetUserEmail: TARGET_EMAIL, backupPath });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeTruthy();
      expect(String(error)).not.toContain('word-128');
      expect(String(error)).not.toContain('x'.repeat(257));
      expect(snapshotBytes()).toEqual(before);
      expect(fs.existsSync(backupPath)).toBe(false);
      testCase.restore();
    }
  });

  it('fails before writing for missing, duplicate, blocked, unconfirmed, and malformed targets', () => {
    const cases = [
      {
        name: 'missing',
        targetEmail: 'missing@example.test',
        mutate: () => undefined,
        restore: () => undefined,
      },
      {
        name: 'duplicate',
        targetEmail: TARGET_EMAIL,
        mutate: () => db.prepare('UPDATE up_users SET email = ? WHERE id = 2').run(' primary@example.test '),
        restore: () => db.prepare('UPDATE up_users SET email = ? WHERE id = 2').run('existing@example.test'),
      },
      {
        name: 'blocked',
        targetEmail: TARGET_EMAIL,
        mutate: () => db.prepare('UPDATE up_users SET blocked = ? WHERE id = 1').run(1),
        restore: () => db.prepare('UPDATE up_users SET blocked = ? WHERE id = 1').run(0),
      },
      {
        name: 'unconfirmed',
        targetEmail: TARGET_EMAIL,
        mutate: () => db.prepare('UPDATE up_users SET confirmed = ? WHERE id = 1').run(0),
        restore: () => db.prepare('UPDATE up_users SET confirmed = ? WHERE id = 1').run(1),
      },
      {
        name: 'null-blocked',
        targetEmail: TARGET_EMAIL,
        mutate: () => db.prepare('UPDATE up_users SET blocked = NULL WHERE id = 1').run(),
        restore: () => db.prepare('UPDATE up_users SET blocked = ? WHERE id = 1').run(0),
      },
      {
        name: 'string-confirmed',
        targetEmail: TARGET_EMAIL,
        mutate: () => db.prepare('UPDATE up_users SET confirmed = ? WHERE id = 1').run('true'),
        restore: () => db.prepare('UPDATE up_users SET confirmed = ? WHERE id = 1').run(1),
      },
      {
        name: 'malformed',
        targetEmail: TARGET_EMAIL,
        mutate: () => db.prepare('UPDATE up_users SET email = ? WHERE id = 1').run('not-an-email'),
        restore: () => db.prepare('UPDATE up_users SET email = ? WHERE id = 1').run('Primary@Example.test'),
      },
    ];

    for (const testCase of cases) {
      testCase.mutate();
      const before = snapshotBytes();
      const backupPath = path.join(tempDir, `${testCase.name}-before.db`);
      let error: unknown;
      try {
        applyMigration({ dbPath, targetUserEmail: testCase.targetEmail, backupPath });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeTruthy();
      expect(String(error)).not.toContain(testCase.targetEmail.toLowerCase());
      expect(snapshotBytes()).toEqual(before);
      expect(fs.existsSync(backupPath)).toBe(false);
      testCase.restore();
    }
  }, 20_000);

  it('fails closed on an unsupported schema before any write', () => {
    db.close();
    db = new Database(dbPath);
    db.exec('ALTER TABLE up_users DROP COLUMN confirmed');
    const before = snapshotBytes();
    expect(() => applyMigration({
      dbPath,
      targetUserEmail: TARGET_EMAIL,
      backupPath: path.join(tempDir, 'schema-before.db'),
    })).toThrow(/schema/i);
    expect(snapshotBytes()).toEqual(before);
  });

});
