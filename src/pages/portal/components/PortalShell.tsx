import type React from 'react';
import { BUYER_MENU } from './menuConfig';
import PortalLayout from './PortalLayout';

/**
 * 买家中心外壳：**左侧边栏导航 + 右内容页**。
 *
 * 保留原来的 `PortalShell` 名字与 `title` 用法，这样 7 个买家页面一行都不用改
 * （它们本来就写成 `<PortalShell title="我的订单">`）。真正决定布局的是 `PortalLayout`。
 *
 * 卖家中心是**另一个独立页面**，用 `seller/components/SellerShell`，
 * 但它和这里共享同一个 `PortalLayout`，所以不存在两套外壳。
 *
 * 支付结果页走 `PortalPlainShell`（流程结束页不该挂侧栏）。
 */
const PortalShell: React.FC<{
  children: React.ReactNode;
  title?: string;
  cartCount?: number;
  /** 宽页面（订单列表）：内容区放宽到 1600，外边距收窄 */
  wide?: boolean;
}> = ({ children, title, cartCount = 0, wide = false }) => (
  <PortalLayout
    menu={BUYER_MENU}
    sectionLabel="买家中心"
    title={title}
    wide={wide}
    cartCount={cartCount}
    switchLink={{ label: '卖家中心', href: '/portal/seller' }}
  >
    {children}
  </PortalLayout>
);

export default PortalShell;
