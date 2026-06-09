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
    // Микросервисы (dev)
    // ─────────────────────────────────────────────────────────────────
    {
      name: 'aklab-parser-fabrikant-dev',
      cwd: __dirname + '/services/parser-fabrikant',
      script: 'npm',
      args: 'run dev',
      interpreter: 'none',
      env: {
        ...process.env,
        NODE_ENV: 'development',
        PORT: '1345',
        SERVICE_NAME: 'parser-fabrikant',
        QUEUE_NAME: 'parse-fabrikant',
        QUEUE_DB_PATH: __dirname + '/queue.db',
        STRAPI_URL: 'http://localhost:1338',
        STRAPI_API_TOKEN: process.env.STRAPI_API_TOKEN || '',
      },
    },
    {
      name: 'aklab-parser-torgi-gov-dev',
      cwd: __dirname + '/services/parser-torgi-gov',
      script: 'npm',
      args: 'run dev',
      interpreter: 'none',
      env: {
        ...process.env,
        NODE_ENV: 'development',
        PORT: '1346',
        SERVICE_NAME: 'parser-torgi-gov',
        QUEUE_NAME: 'parse-torgi-gov',
        QUEUE_DB_PATH: __dirname + '/queue.db',
        STRAPI_URL: 'http://localhost:1338',
        STRAPI_API_TOKEN: process.env.STRAPI_API_TOKEN || '',
      },
    },
    {
      name: 'aklab-analyzer-dev',
      cwd: __dirname + '/services/analyzer',
      script: 'npm',
      args: 'run dev',
      interpreter: 'none',
      env: {
        ...process.env,
        NODE_ENV: 'development',
        QUEUE_DB_PATH: __dirname + '/queue.db',
        STRAPI_URL: 'http://localhost:1338',
        STRAPI_API_TOKEN: process.env.STRAPI_API_TOKEN || '',
      },
    },
    {
      name: 'aklab-digest-dev',
      cwd: __dirname + '/services/digest',
      script: 'npm',
      args: 'run dev',
      interpreter: 'none',
      env: {
        ...process.env,
        NODE_ENV: 'development',
        QUEUE_DB_PATH: __dirname + '/queue.db',
        STRAPI_URL: 'http://localhost:1338',
        STRAPI_API_TOKEN: process.env.STRAPI_API_TOKEN || '',
        EMAIL_SMTP_HOST: process.env.EMAIL_SMTP_HOST || 'smtp.yandex.ru',
        EMAIL_SMTP_PORT: process.env.EMAIL_SMTP_PORT || '465',
        EMAIL_SMTP_USER: process.env.EMAIL_SMTP_USER || '',
        EMAIL_SMTP_PASS: process.env.EMAIL_SMTP_PASS || '',
        EMAIL_DEFAULT_FROM: process.env.EMAIL_DEFAULT_FROM || '',
      },
    },
  ],
};
