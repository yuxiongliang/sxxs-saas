import { describe, expect, it } from 'vitest';
import { columnsForWidth, splitIntoColumns } from './masonry';

describe('splitIntoColumns', () => {
  it('横向优先分配，保证综合排序的阅读顺序', () => {
    const cols = splitIntoColumns([1, 2, 3, 4, 5, 6, 7], 5);
    expect(cols).toEqual([[1, 6], [2, 7], [3], [4], [5]]);
  });

  it('第一行就是前 N 名，从左到右', () => {
    const cols = splitIntoColumns(['a', 'b', 'c'], 3);
    expect(cols.map((col) => col[0])).toEqual(['a', 'b', 'c']);
  });

  it('商品少于列数时不会出现空列之外的错位', () => {
    const cols = splitIntoColumns([1, 2], 5);
    expect(cols.length).toBe(5);
    expect(cols.flat()).toEqual([1, 2]);
  });

  it('列数非法时按 1 列处理', () => {
    expect(splitIntoColumns([1, 2], 0)).toEqual([[1, 2]]);
    expect(splitIntoColumns([1, 2], -3)).toEqual([[1, 2]]);
  });
});

describe('columnsForWidth', () => {
  it('按断点给 5 / 4 / 3 / 2 列', () => {
    expect(columnsForWidth(1600)).toBe(5);
    expect(columnsForWidth(1440)).toBe(5);
    expect(columnsForWidth(1280)).toBe(4);
    expect(columnsForWidth(900)).toBe(3);
    expect(columnsForWidth(375)).toBe(2);
  });
});
