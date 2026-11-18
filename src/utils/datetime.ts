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

/**
 * `2026-11-18 18:15:10` —— **全站默认**（产品要求：时间一律精确到秒）。
 *
 * 只到分钟的展示会导致「一分钟内两笔操作看不出先后」，排查问题时很致命。
 */
export function formatDateTime(value?: string | null): string {
  const date = parse(value);
  if (!date) return '—';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 与 `formatDateTime` 同义（保留旧名字，避免调用方大改） */
export function formatDateTimeFull(value?: string | null): string {
  return formatDateTime(value);
}

/** `2026-11-18` —— 只到日 */
export function formatDate(value?: string | null): string {
  const date = parse(value);
  if (!date) return '—';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
