module.exports = {
  apps: [
    {
      name: 'colmena-web',
      script: './server.production.js',
      cwd: '/var/www/colmena-web',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      max_memory_restart: '512M',
      error_file: '/var/log/colmena/error.log',
      out_file: '/var/log/colmena/out.log',
      time: true
    }
  ]
};
