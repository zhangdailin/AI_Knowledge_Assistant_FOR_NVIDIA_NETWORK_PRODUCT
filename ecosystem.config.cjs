const path = require('path');

module.exports = {
  apps: [
    {
      name: 'ai-assistant-server',
      script: path.join(__dirname, 'server', 'index.mjs'),
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1024M',
      env: {
        NODE_ENV: 'production',
        PORT: 8787
      },
      error_file: path.join(__dirname, 'logs', 'server-err.log'),
      out_file: path.join(__dirname, 'logs', 'server-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      cwd: __dirname
    },
    {
      name: 'ai-assistant-web',
      script: path.join(__dirname, 'start-vite.mjs'),
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1024M',
      env: {
        NODE_ENV: 'development',
        PORT: 5173,
        // 如果需要指定后端 API 地址，取消下面的注释并修改为实际地址
        // VITE_API_SERVER_URL: 'http://172.17.200.222:8787'
      },
      error_file: path.join(__dirname, 'logs', 'web-err.log'),
      out_file: path.join(__dirname, 'logs', 'web-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      cwd: __dirname
    }
  ]
};
