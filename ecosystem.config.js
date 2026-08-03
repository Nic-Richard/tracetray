module.exports = {
  apps: [
    {
      name: 'tracetray',
      script: './server/server.js',
      cwd: '/var/www/tracetray',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
    },
  ],
};
