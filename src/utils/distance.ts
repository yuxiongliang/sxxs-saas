/**
 * 距离展示唯一口径。
 *
 * 单位规则：< 1km 用米（去掉小数，50km 以内没人关心厘米），≥ 1km 用一位小数公里。
 * 50km 以上也只显示一位小数（「123.4km」比「123.456km」更好读）。
 */
export function formatDistance(meters?: number | null): string | null {
  if (meters === null || meters === undefined) return null;
  if (!Number.isFinite(meters) || meters < 0) return null;
  if (meters < 1000) return `${Math.round(meters)}m`;
  const km = meters / 1000;
  // 100km 以上不留小数（「1234km」够了），否则一位小数
  return km >= 100 ? `${Math.round(km)}km` : `${km.toFixed(1)}km`;
}

/** 距离 ≤ 500m 视为「就在附近」，用于卡片上做更友好的文案（可选） */
export function isNearby(meters?: number | null): boolean {
  return typeof meters === 'number' && meters >= 0 && meters <= 500;
}
