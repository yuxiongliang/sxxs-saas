import type { ReactNode } from 'react';

/**
 * 用户中心的两套侧栏菜单。
 *
 * **一个实现、两份配置**：买家中心与卖家中心是**两个独立页面**（各自一整套导航），
 * 但布局组件只写一份，否则改一次要改两遍。
 *
 * 高亮规则：按 pathname **前缀最长匹配**，所以 `/portal/seller/products`
 * 不会同时点亮 `/portal/seller`。
 */

export interface PortalMenuItem {
  key: string;
  label: string;
  href: string;
  icon?: ReactNode;
  /** 精确匹配（如概览页 `/portal`，否则它会点亮所有 `/portal/*`） */
  exact?: boolean;
}

export const BUYER_MENU: PortalMenuItem[] = [
  { key: 'overview', label: '概览', href: '/portal', exact: true },
  // 「消息」紧跟在概览下面：它是买家最高频的入口之一，放最后一项要滑到底
  { key: 'messages', label: '消息', href: '/portal/messages' },
  { key: 'wallet', label: '我的钱包', href: '/portal/wallet' },
  { key: 'orders', label: '我的订单', href: '/portal/orders' },
  { key: 'cart', label: '购物车', href: '/portal/cart' },
  { key: 'favorites', label: '我的收藏', href: '/portal/favorites' },
  { key: 'reviews', label: '我的评价', href: '/portal/reviews' },
  { key: 'addresses', label: '收货地址', href: '/portal/addresses' },
];

export const SELLER_MENU: PortalMenuItem[] = [
  {
    key: 'seller-overview',
    label: '店铺概览',
    href: '/portal/seller',
    exact: true,
  },
  // 配置类入口紧跟概览：概览只看数，改东西去店铺管理
  {
    key: 'seller-shop',
    label: '店铺管理',
    href: '/portal/seller/shop',
  },
  // 与买家中心保持同一顺序：消息紧跟在概览下面
  { key: 'seller-messages', label: '消息', href: '/portal/seller/messages' },
  {
    key: 'seller-products',
    label: '我的商品',
    href: '/portal/seller/products',
  },
  { key: 'seller-orders', label: '我的订单', href: '/portal/seller/orders' },
  {
    key: 'seller-favorites',
    label: '商品收藏',
    href: '/portal/seller/favorites',
  },
  { key: 'seller-reviews', label: '我的评价', href: '/portal/seller/reviews' },
];

/**
 * 找出当前应该点亮的菜单项。
 *
 * 先按 `exact` 精确匹配；否则取**最长的路径前缀**，避免 `/portal` 把
 * `/portal/orders` 也点亮。
 */
export function activeMenuKey(
  menu: PortalMenuItem[],
  pathname: string,
): string {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  const exactHit = menu.find((item) => item.exact && item.href === normalized);
  if (exactHit) return exactHit.key;

  let best: PortalMenuItem | undefined;
  for (const item of menu) {
    if (item.exact) continue;
    if (normalized === item.href || normalized.startsWith(`${item.href}/`)) {
      if (!best || item.href.length > best.href.length) best = item;
    }
  }
  return best?.key ?? '';
}
