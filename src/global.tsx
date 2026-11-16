import '../tailwind.css';

/**
 * 全局运行时保护。
 *
 * **chunk 加载失败自愈**：SPA 的路由是按需加载的，发版后老页面再去要旧 chunk 名，
 * 服务器（或 SPA 回退规则）会返回 `index.html`，浏览器把它当 JS 解析 →
 * `SyntaxError: Unexpected token '<'`；如果这发生在路由切换，页面会停在加载态不动。
 *
 * `public/scripts/loading.js` 已经覆盖了「首次加载就失败」的情况（那段脚本在任何
 * 业务 JS 之前执行）；这里补的是**应用已挂载后切换路由**时的同类错误。
 *
 * 两条规则与 loading.js 保持一致：
 * 1. 只认 chunk 类错误，不吞普通 JS 异常；
 * 2. 同一分钟内最多刷新一次（`sessionStorage`），避免死循环把用户锁死在刷新里。
 */
const RELOAD_KEY = 'app-chunk-reload-at';
const CHUNK_ERROR =
  /Loading chunk|ChunkLoadError|dynamically imported module|Unexpected token '<'|Loading CSS chunk|Importing a module script failed/i;

function isChunkError(message: string): boolean {
  return CHUNK_ERROR.test(message);
}

function tryReload(message: string) {
  if (!isChunkError(message)) return;
  let last = 0;
  try {
    last = Number(window.sessionStorage.getItem(RELOAD_KEY) ?? 0);
  } catch {
    last = 0;
  }
  if (Date.now() - last < 60_000) {
    // 已经刷过一次还是失败：不再刷，把错误留给控制台，避免无限刷新
    console.error(
      '[chunk] 资源加载失败且已自动刷新过一次，请手动刷新或检查部署产物：',
      message,
    );
    return;
  }
  try {
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    /* 忽略存储异常，至少刷一次 */
  }
  console.warn('[chunk] 检测到资源版本不一致，自动刷新一次：', message);
  window.location.reload();
}

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason as { message?: string } | string | undefined;
  tryReload(
    typeof reason === 'string' ? reason : String(reason?.message ?? ''),
  );
});

window.addEventListener(
  'error',
  (event) => {
    tryReload(event.message ?? '');
  },
  true,
);
