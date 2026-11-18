/**
 * 时间展示统一入口。
 *
 * 后端一律返回带时区的 ISO（如 `2026-11-18T10:15:10.768059+00:00`）——**UTC**。
 * 直接截字符串会少 8 小时（以前就踩过），`toLocaleString()` 在不同浏览器/语言下格式又不一样。
 * 所以：统一按**浏览器本地时区**格式化，全站用这一套。
 */

const pad = (value: number) => String(value).padStart(2, '0');

const parse = (value?: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** `2026-11-18 18:15` —— 列表/详情默认用它 */
export function formatDateTime(value?: string | null): string {
  const date = parse(value);
  if (!date) return '—';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `2026-11-18 18:15:10` —— 审计这类需要精确到秒的地方 */
export function formatDateTimeFull(value?: string | null): string {
  const date = parse(value);
  if (!date) return '—';
  return `${formatDateTime(value)}:${pad(date.getSeconds())}`;
}

/** `2026-11-18` —— 只到日 */
export function formatDate(value?: string | null): string {
  const date = parse(value);
  if (!date) return '—';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
