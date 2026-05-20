# Strapi Debugging Insights - May 20, 2026

## Problem
Internal Server Error (500) when accessing `/api/zamers` endpoint even with authenticated user.

## Root Cause
When creating a user via Strapi's `db.query('plugin::users-permissions.user').create()`, the user was NOT being linked to the "authenticated" role in the junction table `up_users_role_lnk`.

The `up_users` table stores user credentials, but the `up_users_role_lnk` table is what actually links users to roles. Strapi's query builder doesn't handle this join table automatically.

## Solution
Use raw SQL instead of Strapi's query builder for user creation, and explicitly insert into the role linking table:

```javascript
// Create user
const result = db.prepare(`
  INSERT INTO up_users (username, email, password, provider, confirmed, blocked, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
`).run(username, email, hashedPassword, 'local', 1, 0);

// CRITICAL: Link user to role
db.prepare('INSERT INTO up_users_role_lnk (user_id, role_id) VALUES (?, ?)').run(result.lastInsertRowid, role.id);
```

## Key Debugging Steps
1. Check PM2 logs: `pm2 logs aklab-api --nostream --lines 50`
2. Check user table: `sqlite3 .tmp/data.db "SELECT * FROM up_users;"`
3. Check role links: `sqlite3 .tmp/data.db "SELECT * FROM up_users_role_lnk;"`
4. Test auth: `curl -X POST /api/auth/local -d '{"identifier":"...", "password":"..."}'`

## Strapi Database Structure
- `up_users` - user accounts
- `up_roles` - roles (type: 'authenticated', 'public')
- `up_users_role_lnk` - junction table (user_id, role_id) - MUST be populated separately
- `up_permissions` - permissions
- `up_permissions_role_lnk` - permission-role mappings

## Ecosystem Config Tip
For Strapi with TypeScript, use `develop` command instead of `start`:
```javascript
args: 'node_modules/@strapi/strapi/bin/strapi.js develop'
```
This allows running without a pre-built `dist` directory.

## Files Modified
- `api/src/seeders/test-users.ts` - uses raw SQL for user creation + role linking

## Tags
#strapi #debugging #permissions #sqlite #user-roles