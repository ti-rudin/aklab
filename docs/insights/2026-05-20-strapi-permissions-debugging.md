# Strapi Debugging Insights - May 20, 2026

## Problem 1: Internal Server Error (500) on /api/zamers
### Root Cause
When creating a user via Strapi's `db.query('plugin::users-permissions.user').create()`, the user was NOT being linked to the "authenticated" role in the junction table `up_users_role_lnk`.

The `up_users` table stores user credentials, but the `up_users_role_lnk` table is what actually links users to roles. Strapi's query builder doesn't handle this join table automatically.

### Solution
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

---

## Problem 2: Content Manager Spinner (admin panel issues)
### Symptoms
- `/admin/content-manager` shows spinner forever
- `/admin/plugins/upload` shows "TypeError: h is not a function"

### Investigation
The error "h is not a function" at line 3278:3801 in strapi bundle is a minified JavaScript error. This could be:
1. Corrupted or outdated build cache
2. Plugin compatibility issue
3. Missing or misconfigured plugin

### Possible Fixes
1. Clear browser cache
2. Rebuild the admin panel: `cd api && npm run build`
3. Check if plugins are installed correctly
4. Check server logs for any plugin initialization errors

---

## Key Debugging Commands
```bash
# Check PM2 logs
pm2 logs aklab-api --nostream --lines 50

# Check user table
sqlite3 api/.tmp/data.db "SELECT * FROM up_users;"

# Check role links
sqlite3 api/.tmp/data.db "SELECT * FROM up_users_role_lnk;"

# Test auth
curl -X POST http://localhost:1338/api/auth/local \
  -H "Content-Type: application/json" \
  -d '{"identifier":"test@aklab.ti-soft.ru","password":"test123456"}'

# Test API access
TOKEN="your-jwt-token"
curl http://localhost:1338/api/zamers -H "Authorization: Bearer $TOKEN"

# Rebuild
cd api && npm run build

# Restart
pm2 restart aklab-api
```

---

## Strapi Database Structure
- `up_users` - user accounts
- `up_roles` - roles (type: 'authenticated', 'public')
- `up_users_role_lnk` - junction table (user_id, role_id) - MUST be populated separately
- `up_permissions` - permissions
- `up_permissions_role_lnk` - permission-role mappings

---

## Ecosystem Config Tip
For production mode with pre-built dist:
```javascript
args: 'node_modules/@strapi/strapi/bin/strapi.js start'
```

For development mode (no build required):
```javascript
args: 'node_modules/@strapi/strapi/bin/strapi.js develop'
```

---

## Files Modified
- `api/src/seeders/test-users.ts` - uses raw SQL for user creation + role linking
- `api/src/seeders/index.ts` - calls seedTestUsers function
- `ecosystem.config.js` - changed to use `start` command after build

---

## Tags
#strapi #debugging #permissions #sqlite #user-roles #content-manager