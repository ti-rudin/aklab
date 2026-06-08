require('dotenv').config({ path: __dirname + '/.env' });

module.exports = {
  apps: [
    {
      name: 'aklab-api',
      cwd: __dirname + '/api',
      script: 'npm',
      args: 'run dev',
      interpreter: 'none',
      health_check: {
        url: 'http://localhost:1338/_health',
        interval: 15000,
        timeout: 5000,
        retries: 3,
      },
      env: {
        ...process.env,
        PORT: process.env.PORT_API || 1338,
      },
    },
    {
      name: 'aklab-app',
      cwd: __dirname + '/app',
      script: 'npm',
      args: 'run dev',
      interpreter: 'none',
      env: {
        ...process.env,
        PORT: process.env.PORT_APP || 5174,
      },
    },
    // ─────────────────────────────────────────────────────────────────
    // Микросервисы (dev): слоты закомментированы, появятся в Фазе 8.
    // В dev режиме сервисы можно запускать отдельно:
    //   cd services/parser-bankruptcy && npm run dev
    // ─────────────────────────────────────────────────────────────────
    // {
    //   name: 'aklab-parser-bankruptcy-dev',
    //   cwd: __dirname + '/services/parser-bankruptcy',
    //   script: 'npm',
    //   args: 'run dev',
    //   interpreter: 'none',
    //   env: {
    //     ...process.env,
    //     NODE_ENV: 'development',
    //     QUEUE_DB_PATH: __dirname + '/queue.db',
    //     STRAPI_URL: 'http://localhost:1338',
    //   },
    // },
  ],
};
