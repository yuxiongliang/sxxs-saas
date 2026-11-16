/**
 * loading 占位
 * 解决首次加载时白屏的问题
 *
 * 另加两层保护（见文件末尾）：
 * 1. **chunk 加载失败自愈**：发版或 dev server 重建后，浏览器可能拿着一份旧 chunk 名，
 *    服务器把 `index.html` 当 JS 返回 → `SyntaxError: Unexpected token '<'` →
 *    React 永远挂不上，用户只会看到下面这段占位。检测到这类错误时刷新一次。
 * 2. **占位超时自救**：10 秒还没挂载就给出「重新加载」入口，不让用户无限转圈。
 */
(() => {
  const _root = document.querySelector('#root');
  if (_root && _root.innerHTML === '') {
    _root.innerHTML = `
      <style>
        html,
        body,
        #root {
          height: 100%;
          margin: 0;
          padding: 0;
        }
        #root {
          background-repeat: no-repeat;
          background-size: 100% auto;
        }

        .loading-title {
          font-size: 1.1rem;
        }

        .loading-sub-title {
          margin-top: 20px;
          font-size: 1rem;
          color: #888;
        }

        .page-loading-warp {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 26px;
        }
        .ant-spin {
          position: absolute;
          display: none;
          -webkit-box-sizing: border-box;
          box-sizing: border-box;
          margin: 0;
          padding: 0;
          color: rgba(0, 0, 0, 0.65);
          color: #1890ff;
          font-size: 14px;
          font-variant: tabular-nums;
          line-height: 1.5;
          text-align: center;
          list-style: none;
          opacity: 0;
          -webkit-transition: -webkit-transform 0.3s
            cubic-bezier(0.78, 0.14, 0.15, 0.86);
          transition: -webkit-transform 0.3s
            cubic-bezier(0.78, 0.14, 0.15, 0.86);
          transition: transform 0.3s cubic-bezier(0.78, 0.14, 0.15, 0.86);
          transition: transform 0.3s cubic-bezier(0.78, 0.14, 0.15, 0.86),
            -webkit-transform 0.3s cubic-bezier(0.78, 0.14, 0.15, 0.86);
          -webkit-font-feature-settings: "tnum";
          font-feature-settings: "tnum";
        }

        .ant-spin-spinning {
          position: static;
          display: inline-block;
          opacity: 1;
        }

        .ant-spin-dot {
          position: relative;
          display: inline-block;
          width: 20px;
          height: 20px;
          font-size: 20px;
        }

        .ant-spin-dot-item {
          position: absolute;
          display: block;
          width: 9px;
          height: 9px;
          background-color: #1890ff;
          border-radius: 100%;
          -webkit-transform: scale(0.75);
          -ms-transform: scale(0.75);
          transform: scale(0.75);
          -webkit-transform-origin: 50% 50%;
          -ms-transform-origin: 50% 50%;
          transform-origin: 50% 50%;
          opacity: 0.3;
          -webkit-animation: antspinmove 1s infinite linear alternate;
          animation: antSpinMove 1s infinite linear alternate;
        }

        .ant-spin-dot-item:nth-child(1) {
          top: 0;
          left: 0;
        }

        .ant-spin-dot-item:nth-child(2) {
          top: 0;
          right: 0;
          -webkit-animation-delay: 0.4s;
          animation-delay: 0.4s;
        }

        .ant-spin-dot-item:nth-child(3) {
          right: 0;
          bottom: 0;
          -webkit-animation-delay: 0.8s;
          animation-delay: 0.8s;
        }

        .ant-spin-dot-item:nth-child(4) {
          bottom: 0;
          left: 0;
          -webkit-animation-delay: 1.2s;
          animation-delay: 1.2s;
        }

        .ant-spin-dot-spin {
          -webkit-transform: rotate(45deg);
          -ms-transform: rotate(45deg);
          transform: rotate(45deg);
          -webkit-animation: antrotate 1.2s infinite linear;
          animation: antRotate 1.2s infinite linear;
        }

        .ant-spin-lg .ant-spin-dot {
          width: 32px;
          height: 32px;
          font-size: 32px;
        }

        .ant-spin-lg .ant-spin-dot i {
          width: 14px;
          height: 14px;
        }

        @media all and (-ms-high-contrast: none), (-ms-high-contrast: active) {
          .ant-spin-blur {
            background: #fff;
            opacity: 0.5;
          }
        }

        @-webkit-keyframes antSpinMove {
          to {
            opacity: 1;
          }
        }

        @keyframes antSpinMove {
          to {
            opacity: 1;
          }
        }

        @-webkit-keyframes antRotate {
          to {
            -webkit-transform: rotate(405deg);
            transform: rotate(405deg);
          }
        }

        @keyframes antRotate {
          to {
            -webkit-transform: rotate(405deg);
            transform: rotate(405deg);
          }
        }
      </style>

      <div style="
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        min-height: 362px;
      ">
        <div class="page-loading-warp">
          <div class="ant-spin ant-spin-lg ant-spin-spinning">
            <span class="ant-spin-dot ant-spin-dot-spin">
              <i class="ant-spin-dot-item"></i>
              <i class="ant-spin-dot-item"></i>
              <i class="ant-spin-dot-item"></i>
              <i class="ant-spin-dot-item"></i>
            </span>
          </div>
        </div>
        <div class="loading-title">
          正在加载资源
        </div>
        <div class="loading-sub-title">
          初次加载资源可能需要较多时间 请耐心等待
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------- 加载自愈
  // 见文件头注释：chunk 过期 / 发版后旧页面，会让浏览器拿到 HTML 当 JS 解析，
  // React 永远挂不上，用户只能看着上面的占位一直转。这里做两件事：
  const RELOAD_KEY = 'app-chunk-reload-at';
  const CHUNK_ERROR = /Loading chunk|ChunkLoadError|dynamically imported module|Unexpected token '<'|Loading CSS chunk|Importing a module script failed/i;

  const tryReload = (message) => {
    if (!CHUNK_ERROR.test(String(message || ''))) return;
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    } catch (error) {
      last = 0;
    }
    // 一分钟内只自愈一次：防死循环，也给用户看到真实报错的机会
    if (Date.now() - last < 60000) return;
    try {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch (error) {
      /* sessionStorage 不可用就算了，至少刷一次 */
    }
    window.location.reload();
  };

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    tryReload(reason && (reason.message || reason));
  });
  // capture=true：<script>/<link> 资源加载失败不冒泡，必须捕获阶段才收得到
  window.addEventListener(
    'error',
    (event) => {
      tryReload(event.message || (event.target && event.target.src) || '');
    },
    true,
  );

  // 占位超时：10 秒还没挂载就给出路（网络慢或 chunk 已失效）
  window.setTimeout(() => {
    const root = document.querySelector('#root');
    if (!root || !root.querySelector('.loading-title')) return;
    const sub = root.querySelector('.loading-sub-title');
    if (sub) {
      sub.innerHTML =
        '资源加载超时。通常是页面版本已更新或网络中断。' +
        '<br/><a href="javascript:location.reload()" style="color:#1677ff">点此重新加载</a>';
    }
  }, 10000);
})();
