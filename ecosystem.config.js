module.exports = {
    apps: [{
      name: 'lt-spin-tracker',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 10000,
      watch: false,
      env: {
        PORT: 4000
      }
    }]
  };
  