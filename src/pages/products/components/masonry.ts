/**
 * 瀑布流分列（纯逻辑，可直接单测）。
 *
 * 为什么按 `index % columns` **横向优先**分配，而不是 CSS `columns`：
 * CSS 多列是**竖向填充**的——第 1 名的商品会被排在左列、第 2 名在其下方，
 * 用户顺着读会觉得「排序怎么乱了」。这里保证阅读顺序是 左→右、再下一行。
 */
export function splitIntoColumns<T>(items: T[], columns: number): T[][] {
  const count = Math.max(1, Math.floor(columns));
  const buckets: T[][] = Array.from({ length: count }, () => []);
  items.forEach((item, index) => {
    buckets[index % count].push(item);
  });
  return buckets;
}

/**
 * 按视口宽度给列数。**一排五个**通常在 ≥1440 才有意义：
 * 再窄每张卡就只剩一百多像素，标题和价格都挤成一行字。
 */
export function columnsForWidth(width: number): number {
  if (width >= 1440) return 5;
  if (width >= 1200) return 4;
  if (width >= 768) return 3;
  return 2;
}

/**
 * 实际列数：**不能多于商品数**，否则会多出空列把已有卡片挤成半宽。
 *
 * 典型场景：详情页「猜你喜欢」只有 1 个推荐商品，两列布局下右半就空了，
 * 卡片只占左半边——看起来像布局坏了。
 */
export function effectiveColumns(desired: number, itemCount: number): number {
  if (itemCount <= 0) return 1;
  return Math.max(1, Math.min(Math.floor(desired), itemCount));
}
