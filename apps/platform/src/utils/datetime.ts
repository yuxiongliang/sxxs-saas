/**
 * 平台端的时间展示（与租户端 `src/utils/datetime.ts` 保持同一套格式）。
 *
 * 两个 app 独立部署、不跨包引用，所以各留一份；**格式必须一致**：
 * `YYYY-MM-DD HH:mm:ss`（精确到秒）。
 */
const pad = (value: number) => String(value).padStart(2, '0');

const parse = (value?: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function formatDateTime(value?: string | null): string {
  const date = parse(value);
  if (!date) return '—';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatDate(value?: string | null): string {
  const date = parse(value);
  if (!date) return '—';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
