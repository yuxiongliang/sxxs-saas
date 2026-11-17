/**
 * pm2 进程管理（此前仓库里没有任何进程管理声明，服务靠 nohup 起）。
 *
 *   pm2 start ecosystem.config.js
 *   pm2 logs sxxs-jobs
 *   pm2 restart sxxs-jobs
 *
 * 两个进程职责分开：
 * - sxxs-api   HTTP 服务
 * - sxxs-jobs  **常驻**延时任务执行器：发货 7 天 / 自提 90 天自动完成。
 *              与 API 解耦，API 重启不影响倒计时；挂了 pm2 自动拉起，
 *              管理页靠心跳（worker_heartbeats）判断它是不是"活着但卡死"。
 */
module.exports = {
  apps: [
    {
      name: 'sxxs-api',
      cwd: './backend',
      script: '.venv/bin/uvicorn',
      args: 'app.main:app --host 0.0.0.0 --port 9000',
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      kill_timeout: 20000,
      max_memory_restart: '600M',
    },
    {
      name: 'sxxs-jobs',
      cwd: './backend',
      script: '.venv/bin/python',
      args: '-m app.worker.jobs',
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      // 收到 SIGTERM 后跑完当前批再退出（pm2 restart 不丢任务）
      kill_timeout: 20000,
      max_memory_restart: '300M',
    },
  ],
};
