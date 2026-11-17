import {
  MenuFoldOutlined,
  ShopOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Link, useLocation, useModel } from '@umijs/max';
import { Badge, Button, Drawer, Layout, Menu, Space } from 'antd';
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { PortalMenuItem } from './menuConfig';
import { activeMenuKey } from './menuConfig';

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
  cartCount = 0,
  sectionLabel,
  switchLink,
}: {
  children: ReactNode;
  menu: PortalMenuItem[];
  title?: string;
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
          label: <Link to={item.href}>{item.label}</Link>,
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
          <Link to={switchLink.href}>
            <Button block icon={<ShopOutlined />}>
              {switchLink.label}
            </Button>
          </Link>
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
          height: 56,
          lineHeight: '56px',
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
          <Link
            to="/products"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontWeight: 700,
            }}
          >
            {brand?.logo_url ? (
              <img
                src={brand.logo_url}
                alt={brand.display_name}
                style={{ height: 24, objectFit: 'contain' }}
              />
            ) : (
              <ShopOutlined />
            )}
            <span style={{ fontSize: 15 }}>
              {brand?.display_name || 'C2C 商城'}
            </span>
          </Link>
          {title ? (
            <span style={{ color: 'var(--ant-color-text-tertiary)' }}>
              / {title}
            </span>
          ) : null}
        </Space>
        <Space size={16}>
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
          style={{ padding: 20, background: 'var(--ant-color-bg-layout)' }}
        >
          <div style={{ maxWidth: 1080, margin: '0 auto' }}>{children}</div>
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
