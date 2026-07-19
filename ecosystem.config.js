// PM2 log rotation: установить один раз на сервере:
//   pm2 install pm2-logrotate
//   pm2 set pm2-logrotate:max_size 10M
//   pm2 set pm2-logrotate:retain 7
//   pm2 set pm2-logrotate:compress true
//   pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm

require('dotenv').config({ path: __dirname + '/.env' });
const services = require('./services/services.json');

// ─────────────────────────────────────────────────────────────────
// Ядро: Strapi API + Vue App
// ─────────────────────────────────────────────────────────────────
const coreApps = [
  {
    name: 'aklab-api',
    cwd: '/home/rudin/aklab/api',
    script: 'node',
    args: 'node_modules/@strapi/strapi/bin/strapi.js start',
    interpreter: 'none',
    max_memory_restart: '768M',
    exp_backoff_restart_delay: 100,
    health_check: {
      url: 'http://localhost:1338/_health',
      interval: 15000,
      timeout: 5000,
      retries: 3,
    },
    env: {
      NODE_ENV: 'production',
      NVM_DIR: '/home/rudin/.nvm',
      PATH: '/home/rudin/.nvm/versions/node/v22.20.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      HOST: process.env.HOST || '0.0.0.0',
      PORT: process.env.PORT_API || '1338',
      PUBLIC_URL: process.env.PUBLIC_URL || '',
      APP_KEYS: process.env.APP_KEYS || '',
      API_TOKEN_SALT: process.env.API_TOKEN_SALT || '',
      ADMIN_JWT_SECRET: process.env.ADMIN_JWT_SECRET || '',
      TRANSFER_TOKEN_SALT: process.env.TRANSFER_TOKEN_SALT || '',
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '',
      JWT_SECRET: process.env.JWT_SECRET || '',
      DATABASE_FILENAME: process.env.DATABASE_FILENAME || '',
      STRAPI_ADMIN_EMAIL: process.env.STRAPI_ADMIN_EMAIL || '',
      STRAPI_ADMIN_PASSWORD: process.env.STRAPI_ADMIN_PASSWORD || '',
    },
  },
  {
    name: 'aklab-app',
    cwd: '/home/rudin/aklab/app',
    script: 'npm',
    args: 'run preview -- --host',
    interpreter: 'none',
    max_memory_restart: '512M',
    exp_backoff_restart_delay: 100,
    env: {
      NODE_ENV: 'production',
      NVM_DIR: '/home/rudin/.nvm',
      PATH: '/home/rudin/.nvm/versions/node/v22.20.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      PORT: process.env.PORT_APP || '4173',
    },
  },
];

// ─────────────────────────────────────────────────────────────────
// Парсеры (prod) — генерируются из services.json
// ─────────────────────────────────────────────────────────────────
const parserApps = services.parsers.map(p => ({
  name: p.pm2_name,
  cwd: '/home/rudin/aklab/services/' + p.slug,
  script: 'node',
  args: 'dist/index.js',
  interpreter: 'none',
  max_memory_restart: '512M',
  exp_backoff_restart_delay: 100,
  env: {
    NODE_ENV: 'production',
    NVM_DIR: '/home/rudin/.nvm',
    PATH: '/home/rudin/.nvm/versions/node/v22.20.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    PORT: String(p.port),
    SERVICE_NAME: p.slug,
    QUEUE_NAME: 'parse-' + p.slug.slice(7),
    QUEUE_DB_PATH: '/home/rudin/aklab/queue.db',
    STRAPI_URL: process.env.STRAPI_INTERNAL_URL || 'http://localhost:1338',
    STRAPI_API_TOKEN: process.env.STRAPI_API_TOKEN || '',
    // Russian Trusted Root + Sub CA для torgi.gov.ru и других гос. сайтов
    NODE_EXTRA_CA_CERTS: '/usr/local/share/ca-certificates/russian-ca-chain.pem',
  },
}));

// ─────────────────────────────────────────────────────────────────
// Воркеры (prod)
// ─────────────────────────────────────────────────────────────────
const workerApps = [
  {
    name: 'aklab-analyzer-prod',
    cwd: '/home/rudin/aklab/services/analyzer',
    script: 'node',
    args: 'dist/index.js',
    interpreter: 'none',
    max_memory_restart: '512M',
    exp_backoff_restart_delay: 100,
    env: {
      NODE_ENV: 'production',
      NVM_DIR: '/home/rudin/.nvm',
      PATH: '/home/rudin/.nvm/versions/node/v22.20.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      QUEUE_DB_PATH: '/home/rudin/aklab/queue.db',
      STRAPI_URL: process.env.STRAPI_INTERNAL_URL || 'http://localhost:1338',
      STRAPI_API_TOKEN: process.env.STRAPI_API_TOKEN || '',
    },
  },
  {
    name: 'aklab-digest-prod',
    cwd: '/home/rudin/aklab/services/digest',
    script: 'node',
    args: 'dist/index.js',
    interpreter: 'none',
    max_memory_restart: '512M',
    exp_backoff_restart_delay: 100,
    env: {
      NODE_ENV: 'production',
      NVM_DIR: '/home/rudin/.nvm',
      PATH: '/home/rudin/.nvm/versions/node/v22.20.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      QUEUE_DB_PATH: '/home/rudin/aklab/queue.db',
      STRAPI_URL: process.env.STRAPI_INTERNAL_URL || 'http://localhost:1338',
      STRAPI_API_TOKEN: process.env.STRAPI_API_TOKEN || '',
      EMAIL_SMTP_HOST: process.env.EMAIL_SMTP_HOST || 'smtp.yandex.ru',
      EMAIL_SMTP_PORT: process.env.EMAIL_SMTP_PORT || '465',
      EMAIL_SMTP_USER: process.env.EMAIL_SMTP_USER || '',
      EMAIL_SMTP_PASS: process.env.EMAIL_SMTP_PASS || '',
      EMAIL_DEFAULT_FROM: process.env.EMAIL_DEFAULT_FROM || '',
    },
  },
  {
    name: 'aklab-photo-fetcher-prod',
    cwd: '/home/rudin/aklab/services/photo-fetcher',
    script: 'node',
    args: 'dist/index.js',
    interpreter: 'none',
    max_memory_restart: '512M',
    exp_backoff_restart_delay: 100,
    env: {
      NODE_ENV: 'production',
      NVM_DIR: '/home/rudin/.nvm',
      PATH: '/home/rudin/.nvm/versions/node/v22.20.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      PORT: '1356',
      QUEUE_DB_PATH: '/home/rudin/aklab/queue.db',
      STRAPI_URL: process.env.STRAPI_INTERNAL_URL || 'http://localhost:1338',
      STRAPI_API_TOKEN: process.env.STRAPI_API_TOKEN || '',
      // Node fetch trusts the Russian CA chain used by torgi.gov.ru.
      NODE_EXTRA_CA_CERTS: '/usr/local/share/ca-certificates/russian-ca-chain.pem',
    },
  },
];

module.exports = {
  apps: [...coreApps, ...parserApps, ...workerApps],
};
