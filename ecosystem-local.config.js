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
  ],
};
