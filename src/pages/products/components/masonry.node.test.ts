import { describe, expect, it } from 'vitest';
import { columnsForWidth, effectiveColumns, splitIntoColumns } from './masonry';

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

describe('effectiveColumns', () => {
  it('商品数少于期望列数时，不制造空列', () => {
    // 详情页「猜你喜欢」只剩 1 个推荐时，两列会把卡片挤成半宽
    expect(effectiveColumns(2, 1)).toBe(1);
    expect(effectiveColumns(5, 2)).toBe(2);
  });

  it('商品足够多时按期望列数', () => {
    expect(effectiveColumns(5, 40)).toBe(5);
    expect(effectiveColumns(2, 12)).toBe(2);
  });

  it('空列表与非法列数都不炸', () => {
    expect(effectiveColumns(5, 0)).toBe(1);
    expect(effectiveColumns(0, 10)).toBe(1);
  });
});
