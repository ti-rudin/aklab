/**
 * Fix property-event permissions for authenticated role
 * Run: node scripts/fix-property-event-perms.js
 */
'use strict';

const Strapi = require('@strapi/strapi');

(async () => {
  const app = await Strapi().load();
  
  // Get authenticated role
  const role = await app.db.query('plugin::users-permissions.role').findOne({
    where: { type: 'authenticated' }
  });
  
  if (!role) {
    console.error('Authenticated role not found');
    await app.destroy();
    process.exit(1);
  }
  
  console.log('Role:', role.id, role.name);
  
  // Check existing property-event permissions
  const existingPerms = await app.db.query('plugin::users-permissions.permission').findMany({
    where: {
      role: role.id,
      action: { $contains: 'property-event' }
    }
  });
  console.log('Existing property-event perms:', existingPerms.length);
  existingPerms.forEach(p => console.log('  -', p.action));
  
  // Add missing permissions
  const actions = [
    'api::property-event.property-event.find',
    'api::property-event.property-event.findOne',
  ];
  
  for (const action of actions) {
    const exists = existingPerms.find(p => p.action === action);
    if (!exists) {
      await app.db.query('plugin::users-permissions.permission').create({
        data: {
          action,
          role: role.id,
        }
      });
      console.log('Created permission:', action);
    } else {
      console.log('Already exists:', action);
    }
  }
  
  console.log('Done!');
  await app.destroy();
})();
