import { describe, expect, it } from 'vitest';
import {
  buildCombos,
  comboKey,
  isComboComplete,
  isSellable,
  resolveMedia,
  skuNameFor,
} from './specUtils';

const SIZE_COLOR = [
  { name: '尺码', values: [{ value: 'XL' }, { value: 'L' }] },
  { name: '颜色', values: [{ value: '黑色' }, { value: '白色' }] },
];

describe('buildCombos', () => {
  it('做笛卡尔积：2 组 × 2 值 = 4 个组合', () => {
    const combos = buildCombos(SIZE_COLOR);
    expect(combos).toHaveLength(4);
    expect(combos).toContainEqual({ 尺码: 'XL', 颜色: '黑色' });
    expect(combos).toContainEqual({ 尺码: 'L', 颜色: '白色' });
  });

  it('没有规格时返回一个空组合（单规格商品）', () => {
    expect(buildCombos([])).toEqual([{}]);
  });

  it('忽略没填名字的规格组与空值', () => {
    const combos = buildCombos([
      { name: '', values: [{ value: 'X' }] },
      { name: '颜色', values: [{ value: '黑色' }, { value: '  ' }] },
    ]);
    expect(combos).toEqual([{ 颜色: '黑色' }]);
  });

  it('三级规格也能正确展开', () => {
    const combos = buildCombos([
      { name: '尺码', values: [{ value: 'XL' }] },
      { name: '颜色', values: [{ value: '黑色' }] },
      { name: '款式', values: [{ value: '薄款' }, { value: '厚款' }] },
    ]);
    expect(combos).toHaveLength(2);
    expect(combos[0]).toEqual({ 尺码: 'XL', 颜色: '黑色', 款式: '薄款' });
  });
});

describe('comboKey', () => {
  it('与规格组书写顺序无关', () => {
    expect(comboKey({ 尺码: 'XL', 颜色: '黑色' })).toBe(
      comboKey({ 颜色: '黑色', 尺码: 'XL' }),
    );
  });

  it('空组合有稳定键', () => {
    expect(comboKey({})).toBe('__default__');
  });
});

describe('skuNameFor', () => {
  it('按规格值拼展示名', () => {
    expect(skuNameFor({ 尺码: 'XL', 颜色: '黑色' })).toBe('XL / 黑色');
  });

  it('单规格返回「默认」', () => {
    expect(skuNameFor({})).toBe('默认');
  });
});

describe('isSellable', () => {
  const skus = [
    { specs: { 尺码: 'XL', 颜色: '黑色' }, status: 'active' },
    { specs: { 尺码: 'L', 颜色: '黑色' }, status: 'inactive' },
  ];

  it('存在匹配的 active SKU 才算可售', () => {
    expect(isSellable(skus, SIZE_COLOR, { 尺码: 'XL', 颜色: '黑色' })).toBe(
      true,
    );
  });

  it('停用的组合不算可售', () => {
    expect(isSellable(skus, SIZE_COLOR, { 尺码: 'L', 颜色: '黑色' })).toBe(
      false,
    );
  });

  it('完全没有该组合也不算', () => {
    expect(isSellable(skus, SIZE_COLOR, { 尺码: 'XL', 颜色: '白色' })).toBe(
      false,
    );
  });

  // 防止重蹈覆辙：以前要求「所有组都选完」才返回 true，
  // 导致多规格商品第一组的选项全部置灰，买家直接卡死。
  it('只选了一组时，兼容的可售 SKU 存在就能点', () => {
    expect(isSellable(skus, SIZE_COLOR, { 尺码: 'XL' })).toBe(true);
  });

  it('只选了一组时，没有兼容 SKU 就置灰', () => {
    expect(isSellable(skus, SIZE_COLOR, { 尺码: 'L' })).toBe(false);
  });

  it('一个都没选时不应该把所有选项都置灰', () => {
    expect(isSellable(skus, SIZE_COLOR, {})).toBe(true);
  });
});

describe('isComboComplete', () => {
  it('少选一组即未选全', () => {
    expect(isComboComplete(SIZE_COLOR, { 尺码: 'XL' })).toBe(false);
  });

  it('全部选完为 true', () => {
    expect(isComboComplete(SIZE_COLOR, { 尺码: 'XL', 颜色: '黑色' })).toBe(
      true,
    );
  });

  it('无规格商品永远算选全', () => {
    expect(isComboComplete([], {})).toBe(true);
  });
});

describe('resolveMedia 取图优先级', () => {
  const groups = [
    {
      name: '颜色',
      values: [
        { value: '黑色', image_url: '/spec-black.png' },
        { value: '白色', video_url: '/spec-white.mp4' },
      ],
    },
  ];

  it('SKU 覆盖图优先于规格值图与主图', () => {
    const media = resolveMedia({
      skuImage: '/sku.png',
      groups,
      selected: { 颜色: '黑色' },
      mainImage: '/main.png',
    });
    expect(media).toEqual({ url: '/sku.png', isVideo: false });
  });

  it('没有 SKU 图时用规格值图', () => {
    const media = resolveMedia({
      groups,
      selected: { 颜色: '黑色' },
      mainImage: '/main.png',
    });
    expect(media).toEqual({ url: '/spec-black.png', isVideo: false });
  });

  it('规格值只挂了视频时按视频返回', () => {
    const media = resolveMedia({ groups, selected: { 颜色: '白色' } });
    expect(media).toEqual({ url: '/spec-white.mp4', isVideo: true });
  });

  it('都没有时回落到商品主图', () => {
    const media = resolveMedia({
      groups,
      selected: {},
      mainImage: '/main.png',
    });
    expect(media).toEqual({ url: '/main.png', isVideo: false });
  });

  it('连主图都没有就返回 undefined', () => {
    expect(resolveMedia({ groups: [], selected: {} })).toBeUndefined();
  });

  it('SKU 覆盖视频优先于规格值图', () => {
    const media = resolveMedia({
      skuVideo: '/sku.mp4',
      groups,
      selected: { 颜色: '黑色' },
      mainImage: '/main.png',
    });
    expect(media).toEqual({ url: '/sku.mp4', isVideo: true });
  });
});
