require('dotenv').config({ path: __dirname + '/.env' });

module.exports = {
  apps: [
    {
      name: 'aklab-api',
      cwd: '/home/rudin/aklab/api',
      script: 'node',
      args: 'node_modules/@strapi/strapi/bin/strapi.js start',
      interpreter: 'none',
      health_check: {
        url: 'http://localhost:1338/_health',
        interval: 15000,
        timeout: 5000,
        retries: 3,
      },
      env: {
        ...process.env,
        PORT: process.env.PORT_API,
        NVM_DIR: '/home/rudin/.nvm',
        PATH: '/home/rudin/.nvm/versions/node/v22.20.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      },
    },
    {
      name: 'aklab-app',
      cwd: '/home/rudin/aklab/app',
      script: 'npm',
      args: 'run preview -- --host',
      interpreter: 'none',
      env: {
        ...process.env,
        PORT: process.env.PORT_APP,
        NVM_DIR: '/home/rudin/.nvm',
        PATH: '/home/rudin/.nvm/versions/node/v22.20.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      },
    },
    // ─────────────────────────────────────────────────────────────────
    // Микросервисы (Фаза 8 — deploy, Фазы 4-7 — реализация)
    // Слоты закомментированы: при появлении services/* раскомментировать.
    // ─────────────────────────────────────────────────────────────────
    // {
    //   name: 'aklab-parser-bankruptcy-prod',
    //   cwd: '/home/rudin/aklab/services/parser-bankruptcy',
    //   script: 'node',
    //   args: 'dist/index.js',
    //   interpreter: 'none',
    //   env: {
    //     ...process.env,
    //     NODE_ENV: 'production',
    //     NVM_DIR: '/home/rudin/.nvm',
    //     PATH: '/home/rudin/.nvm/versions/node/v22.20.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    //     QUEUE_DB_PATH: '/home/rudin/aklab/queue.db',
    //     STRAPI_URL: process.env.STRAPI_INTERNAL_URL || 'http://localhost:1338',
    //   },
    // },
    // {
    //   name: 'aklab-analyzer-prod',
    //   cwd: '/home/rudin/aklab/services/analyzer',
    //   script: 'node',
    //   args: 'dist/index.js',
    //   interpreter: 'none',
    //   env: { ...то же... },
    // },
    // {
    //   name: 'aklab-digest-prod',
    //   cwd: '/home/rudin/aklab/services/digest',
    //   script: 'node',
    //   args: 'dist/index.js',
    //   interpreter: 'none',
    //   env: { ...то же... },
    // },
  ],
};