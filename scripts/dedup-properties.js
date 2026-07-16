#!/usr/bin/env node
/**
 * Backward-compatible safe entrypoint.
 *
 * The former implementation deleted duplicate rows and photo directories without
 * migrating relations, a backup, or a unique DB guard. Keep this filename for
 * operators, but delegate to the audited migration command instead.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const result = spawnSync(process.execPath, [path.join(__dirname, 'migrate-property-identity.js'), ...process.argv.slice(2)], {
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
