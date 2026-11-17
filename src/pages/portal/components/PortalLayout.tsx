import {
  MenuFoldOutlined,
  ShopOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useModel } from '@umijs/max';
import { Badge, Button, Drawer, Layout, Menu, Space } from 'antd';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { LangDropdown } from '@/components/RightContent/LangDropdown';
import ThemeSwitch from '@/components/RightContent/ThemeSwitch';
import { listConversations } from '@/services/im/api';
import type { PortalMenuItem } from './menuConfig';
import { activeMenuKey } from './menuConfig';
import PortalBrand, { PORTAL_HEADER_HEIGHT } from './PortalBrand';

const { Header, Sider, Content } = Layout;

/**
 * 用户中心布局：**左侧边栏导航 + 右内容页**。
 *
 * 买家中心与卖家中心是两个**独立页面**（各自一整套菜单），但共用这一个组件：
 * 传不同的 `menu` / `sectionLabel` / `switchLink` 即可，避免维护两套外壳。
 *
 * 顶栏只保留三样：Logo（回商城）、购物车、当前用户名 —— 导航一律在侧栏，
 * 顶部再放一排链接会和侧栏重复。
 *
 * 纯布局，不含任何业务判断（卖家开店态由 `seller/components/SellerShell` 负责）。
 */
export default function PortalLayout({
  children,
  menu,
  title,
  wide = false,
  cartCount = 0,
  sectionLabel,
  switchLink,
}: {
  children: ReactNode;
  menu: PortalMenuItem[];
  title?: string;
  /** 宽页面（订单列表这种列很多的）：放宽内容区，收窄外边距 */
  wide?: boolean;
  cartCount?: number;
  /** 侧栏分组标题，如「买家中心」「卖家中心」 */
  sectionLabel: string;
  /** 跨中心入口：买家中心 →「卖家中心」，卖家中心 →「返回买家中心」 */
  switchLink?: { label: string; href: string };
}) {
  const { initialState } = useModel('@@initialState');
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const brand = initialState?.brand;
  const active = activeMenuKey(menu, pathname);
  // 未读角标：菜单里有「消息」时才查（避免每个页面都多打一次接口）
  const hasMessages = menu.some((item) => item.href.endsWith('/messages'));
  const { data: conversations } = useQuery({
    queryKey: ['im-conversations'],
    queryFn: listConversations,
    enabled: hasMessages,
    refetchInterval: 15_000,
  });
  const unreadTotal = (conversations ?? []).reduce(
    (sum, item) =>
      sum +
      (sectionLabel === '卖家中心'
        ? item.seller_unread_count
        : item.buyer_unread_count),
    0,
  );

  // 面包屑去掉了，`title` 改用作浏览器标签页标题（否则这个参数就变成死参数）
  useEffect(() => {
    const site = brand?.display_name;
    document.title = title
      ? site
        ? `${title} - ${site}`
        : title
      : site || document.title;
  }, [title, brand?.display_name]);

  const nav = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          padding: '14px 16px 8px',
          fontSize: 12,
          color: 'var(--ant-color-text-tertiary)',
        }}
      >
        {sectionLabel}
      </div>
      <Menu
        mode="inline"
        selectedKeys={active ? [active] : []}
        items={menu.map((item) => ({
          key: item.key,
          label: (
            <Link to={item.href}>
              {item.label}
              {item.href.endsWith('/messages') && unreadTotal > 0 ? (
                <Badge
                  count={unreadTotal}
                  size="small"
                  style={{ marginLeft: 8 }}
                />
              ) : null}
            </Link>
          ),
          icon: item.icon,
        }))}
        style={{ borderInlineEnd: 'none', flex: 1 }}
        onClick={() => setDrawerOpen(false)}
      />
      {switchLink ? (
        <div
          style={{
            padding: 12,
            borderTop: '1px solid var(--ant-color-border-secondary)',
          }}
        >
          {/* 两个中心是独立页面：新窗口打开，买家中心的工作现场不被打断 */}
          <Button
            block
            icon={<ShopOutlined />}
            href={switchLink.href}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="portal-switch-link"
          >
            {switchLink.label}
          </Button>
        </div>
      ) : null}
    </div>
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          background: 'var(--ant-color-bg-container)',
          borderBottom: '1px solid var(--ant-color-border-secondary)',
          paddingInline: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: PORTAL_HEADER_HEIGHT,
          lineHeight: `${PORTAL_HEADER_HEIGHT}px`,
        }}
      >
        <Space size={12}>
          {/* 小屏出现：侧栏收进 Drawer */}
          <Button
            type="text"
            className="portal-menu-toggle"
            icon={<MenuFoldOutlined />}
            onClick={() => setDrawerOpen(true)}
            aria-label="打开菜单"
            style={{ display: 'none' }}
          />
          <PortalBrand brand={brand} />
          {/* 面包屑已去掉：导航在侧栏，顶部再挂一层标题冗余 */}
        </Space>
        <Space size={12}>
          <LangDropdown />
          <ThemeSwitch />
          <Link to="/portal/cart">
            <Badge count={cartCount} size="small" offset={[8, -2]}>
              <span style={{ fontSize: 13 }}>购物车</span>
            </Badge>
          </Link>
          <span
            style={{ fontSize: 13, color: 'var(--ant-color-text-secondary)' }}
          >
            <UserOutlined /> {initialState?.currentUser?.name || '买家'}
          </span>
        </Space>
      </Header>

      <Layout>
        <Sider
          width={200}
          theme="light"
          className="portal-sider"
          style={{
            borderInlineEnd: '1px solid var(--ant-color-border-secondary)',
          }}
        >
          {nav}
        </Sider>

        <Content
          style={{
            // 宽页面收窄外边距：列多的表格被 1080 卡住会疯狂横向滚动
            padding: wide ? 12 : 20,
            background: 'var(--ant-color-bg-layout)',
          }}
        >
          <div
            style={{
              maxWidth: wide ? 1600 : 1080,
              margin: '0 auto',
            }}
          >
            {children}
          </div>
        </Content>
      </Layout>

      <Drawer
        placement="left"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={220}
        styles={{ body: { padding: 0 } }}
        title={sectionLabel}
      >
        {nav}
      </Drawer>

      {/* 断点规则集中在这里，页面不需要知道 */}
      <style>{`
        @media (max-width: 767px) {
          .portal-sider { display: none !important; }
          .portal-menu-toggle { display: inline-flex !important; }
        }
      `}</style>
    </Layout>
  );
}
