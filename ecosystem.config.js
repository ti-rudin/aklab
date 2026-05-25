require('dotenv').config({ path: __dirname + '/.env' });

module.exports = {
  apps: [
    {
      name: 'aklab-api',
      cwd: '/home/rudin/aklab/api',
      script: 'npm',
      args: 'run develop',
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
  ],
};