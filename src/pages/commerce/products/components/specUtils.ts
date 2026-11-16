/**
 * 多规格的纯逻辑：组合生成、组合键、可售判定、展示区取图优先级。
 *
 * 单独抽出来的原因：这几条规则同时被**卖家/运营的编辑器**和**买家详情页**使用，
 * 两边各写一遍必然漂移；而它们又都是纯函数，可以在无浏览器的 `*.node.test.ts`
 * 里直接测（本项目 browser 模式的 vitest 在本机跑不起来，见 README 的测试小节）。
 */

export interface SpecValueLike {
  value: string;
  image_url?: string | null;
  video_url?: string | null;
}

export interface SpecGroupLike {
  name: string;
  values: SpecValueLike[];
}

/** {规格组名: 规格值} */
export type Combo = Record<string, string>;

const DEFAULT_KEY = '__default__';

/** 笛卡尔积：每个组合是一个 SKU。没有可用规格时返回 `[{}]`（单规格商品）。 */
export function buildCombos(groups: SpecGroupLike[]): Combo[] {
  const usable = groups.filter(
    (group) => group.name.trim() && group.values.some((v) => v.value.trim()),
  );
  if (!usable.length) return [{}];
  return usable.reduce<Combo[]>(
    (acc, group) => {
      const next: Combo[] = [];
      for (const base of acc) {
        for (const value of group.values) {
          if (!value.value.trim()) continue;
          next.push({ ...base, [group.name.trim()]: value.value.trim() });
        }
      }
      return next;
    },
    [{}],
  );
}

/** 组合键：与规格组的书写顺序无关，`{颜色,尺码}` 与 `{尺码,颜色}` 视为同一组合。 */
export function comboKey(combo: Combo = {}): string {
  const keys = Object.keys(combo).sort();
  if (!keys.length) return DEFAULT_KEY;
  return keys.map((key) => `${key}=${combo[key]}`).join('|');
}

/** SKU 展示名：`XL / 黑色`。 */
export function skuNameFor(combo: Combo): string {
  const keys = Object.keys(combo);
  if (!keys.length) return '默认';
  return keys.map((key) => combo[key]).join(' / ');
}

/**
 * 某个候选组合是否还能买到（买家端据此把不可能的组合置灰）。
 * 只有 `status === 'active'` 的 SKU 参与判定。
 *
 * **只比对已经选中的规格组**（部分匹配）。
 * 以前这里要求 `groups.every(...)` —— 也就是必须**所有组都选完**才可能返回 true，
 * 结果是两组规格的商品：第一组一个值都点不动（candidate 里第二组还是 undefined），
 * 买家直接卡死在详情页。现在选中「尺码=xl」时，只要存在 `尺码=xl` 的可售 SKU
 * 就允许点，选完第二组再缩小范围。
 */
export function isSellable(
  skus: Array<{ specs?: Combo | null; status?: string }>,
  groups: SpecGroupLike[],
  candidate: Combo,
): boolean {
  // 只拿「已经选了值」的组做比对；一个都没选时谈不上不可售
  const decided = groups.filter((group) => candidate[group.name] !== undefined);
  if (!decided.length) return true;
  return skus.some(
    (sku) =>
      (sku.status ?? 'active') === 'active' &&
      decided.every(
        (group) => sku.specs?.[group.name] === candidate[group.name],
      ),
  );
}

export interface ResolvedMedia {
  url: string;
  isVideo: boolean;
}

/**
 * 展示区取哪张图：**SKU 覆盖图 > 规格值图 > 商品主图**。
 *
 * 规格值图按规格组顺序找第一个挂了媒体的值（用户在一个组合里通常会同时选中
 * 「黑色」和「XL」，谁带图就先用谁）。
 */
export function resolveMedia(input: {
  skuImage?: string | null;
  skuVideo?: string | null;
  groups: SpecGroupLike[];
  selected: Combo;
  mainImage?: string | null;
}): ResolvedMedia | undefined {
  const { skuImage, skuVideo, groups, selected, mainImage } = input;
  if (skuImage) return { url: skuImage, isVideo: false };
  if (skuVideo) return { url: skuVideo, isVideo: true };

  for (const group of groups) {
    const chosen = selected[group.name];
    if (!chosen) continue;
    const value = group.values.find((item) => item.value === chosen);
    if (value?.image_url) return { url: value.image_url, isVideo: false };
    if (value?.video_url) return { url: value.video_url, isVideo: true };
  }

  return mainImage ? { url: mainImage, isVideo: false } : undefined;
}

/** 买家端：规格是否已选全（没选全就不认定 SKU）。 */
export function isComboComplete(
  groups: SpecGroupLike[],
  selected: Combo,
): boolean {
  if (!groups.length) return true;
  return groups.every((group) => Boolean(selected[group.name]));
}
