import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatDateTimeFull } from './datetime';

/**
 * 全站时间必须精确到秒（产品口径）。
 *
 * 只到分钟会让「一分钟内的两笔操作」看不出先后，排查问题时会误判；
 * 这条测试锁住格式，避免有人为了"好看"把秒去掉。
 */
describe('formatDateTime', () => {
  it('精确到秒，并按本地时区渲染', () => {
    const iso = '2026-11-18T10:15:10.768059+00:00';
    const text = formatDateTime(iso);
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    // 与本地时区解析结果一致（不能是 UTC 截断）
    const date = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(text).toBe(
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    );
  });

  it('formatDateTimeFull 与 formatDateTime 同格式', () => {
    const iso = '2026-11-18T10:15:10.768059+00:00';
    expect(formatDateTimeFull(iso)).toBe(formatDateTime(iso));
  });

  it('空值与非法值给占位符', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('—');
  });

  it('formatDate 只到日', () => {
    expect(formatDate('2026-11-18T10:15:10.000Z')).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });
});
