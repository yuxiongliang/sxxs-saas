import { CloseCircleOutlined } from '@ant-design/icons';
import { history, useIntl, useLocation, useSelectedRoutes } from '@umijs/max';
import { Badge, Button, Tabs, theme } from 'antd';
import React, { useEffect, useMemo, useState } from 'react';

interface PageTab {
  path: string;
  /** 路由模式下是 i18n key；菜单模式下直接用中文标题 */
  name: string;
  closable: boolean;
}

/**
 * 内容区顶部的**横向标签栏**，两种驱动方式，一个实现：
 *
 * 1. **路由驱动**（默认，租户控制台用）：靠 `useSelectedRoutes` 的 `route.name`
 *    拼 `menu.xxx` 取标题，首页固定 `/dashboard/analysis`。
 * 2. **菜单驱动**（传 `menu` + `home`，买家/卖家中心用）：门户页面没有 `name`，
 *    标题按**菜单最长前缀**匹配；非菜单页面不生成标签（避免一堆 `/portal/xxx` 裸路径）。
 *
 * 共同语义（两端一致，别各写一套）：
 * - 首页/概览标签**常驻不可关**，关掉最后一个标签就没人知道自己在哪；
 * - 关当前标签 → 回左邻，没有左邻取右邻，再没有回首页；
 * - 「关闭全部」= 回首页（只留首页标签）；
 * - 传 `storageKey` 时用 sessionStorage 持久化，刷新不丢（按中心隔离）。
 */
export interface PageTabMenuItem {
  href: string;
  label: string;
  /** 首页/概览这种"只能精确命中"的项：否则它会把所有子路径都点亮成自己 */
  exact?: boolean;
}

//: 门户每个页面都自己渲染一次外壳 → PageTabs 会随导航重挂。state 靠这个缓存接力。
const tabCache = new Map<string, PageTab[]>();

const normalizePath = (pathname: string) => {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.replace(/\/+$/, '');
  }
  return pathname || '/';
};

/** 菜单最长前缀匹配：`/portal/seller/products` 归到「我的商品」而不是「店铺概览」。
 *  `exact` 的项（概览/首页）只认完全相等 —— 否则 `/portal/seller/products`
 *  会被它按前缀吃掉，标签上显示成「店铺概览」。 */
function matchMenu(items: PageTabMenuItem[], path: string) {
  let best: PageTabMenuItem | undefined;
  for (const item of items) {
    const hit = item.exact
      ? path === item.href
      : path === item.href || path.startsWith(`${item.href}/`);
    if (hit && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}

const PageTabs: React.FC<{
  /** 菜单驱动模式：可点开成标签的页面集合 */
  menu?: PageTabMenuItem[];
  /** 菜单驱动模式：常驻首页（概览） */
  home?: PageTabMenuItem;
  /** 传了就持久化（门户按中心分开存，避免买家/卖家互相串） */
  storageKey?: string;
  /** 标签上的未读数（如「消息」），key 是 href */
  badges?: Record<string, number>;
}> = ({ menu, home, storageKey, badges }) => {
  const location = useLocation();
  const selectedRoutes = useSelectedRoutes();
  const intl = useIntl();
  const { token } = theme.useToken();
  const path = normalizePath(location.pathname);
  const menuDriven = Boolean(menu && home);
  const menuItems = menu ?? [];

  const routeNames = useMemo(
    () =>
      selectedRoutes
        .map((item: any) => item?.route?.name)
        .filter(
          (name: unknown): name is string =>
            typeof name === 'string' && name.length > 0,
        ),
    [selectedRoutes],
  );

  const homeTab: PageTab = {
    path: home?.href ?? '/dashboard/analysis',
    name: home?.label ?? 'menu.dashboard.analysis',
    closable: false,
  };

  const [tabs, setTabsState] = useState<PageTab[]>(() => {
    if (!menuDriven || !storageKey) return [homeTab];
    // 同一会话内切换页面：内存缓存比 sessionStorage 新
    const cached = tabCache.get(storageKey);
    if (cached) return cached;
    try {
      const raw = sessionStorage.getItem(storageKey);
      const saved: string[] = raw ? JSON.parse(raw) : [];
      const restored = (Array.isArray(saved) ? saved : [])
        .map((href) => menuItems.find((item) => item.href === href))
        .filter((item): item is PageTabMenuItem => Boolean(item))
        .map((item) => ({ path: item.href, name: item.label, closable: true }));
      // 首页永远在第一格且不可关
      return [homeTab, ...restored.filter((tab) => tab.path !== homeTab.path)];
    } catch {
      return [homeTab];
    }
  });

  /** 唯一的写入口：**同步**更新缓存与 sessionStorage，再更新 state。 */
  const setTabs = (updater: PageTab[] | ((prev: PageTab[]) => PageTab[])) => {
    setTabsState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (menuDriven && storageKey) {
        tabCache.set(storageKey, next);
        try {
          sessionStorage.setItem(
            storageKey,
            JSON.stringify(next.map((tab) => tab.path)),
          );
        } catch {
          /* 隐私模式禁写 sessionStorage：退化成"刷新丢标签"，不影响导航 */
        }
      }
      return next;
    });
  };

  // 当前页入列：菜单里找不到的路径（如支付结果页）不生成标签
  const currentMenu = menuDriven ? matchMenu(menuItems, path) : undefined;
  const currentName = menuDriven
    ? (currentMenu?.label ?? '')
    : routeNames.length
      ? `menu.${routeNames.join('.')}`
      : path;

  useEffect(() => {
    if (path === '/' || path.startsWith('/user/')) return;
    if (menuDriven && !currentMenu) return;
    setTabs((previous) => {
      if (previous.some((tab) => tab.path === path)) return previous;
      return [...previous, { path, name: currentName, closable: true }];
    });
  }, [currentMenu, currentName, menuDriven, path]);

  const closeTab = (targetPath: string) => {
    if (targetPath === homeTab.path) return;
    const index = tabs.findIndex((tab) => tab.path === targetPath);
    const nextTabs = tabs.filter((tab) => tab.path !== targetPath);
    setTabs(nextTabs);
    if (path === targetPath) {
      const fallback = nextTabs[Math.max(0, index - 1)] ?? homeTab;
      history.push(fallback.path);
    }
  };

  const closeAll = () => {
    setTabs([homeTab]);
    if (path !== homeTab.path) history.push(homeTab.path);
  };

  const labelOf = (tab: PageTab) => {
    // 菜单驱动模式下标题在渲染时重新解析：卖家中心菜单在"开店态"还没确定时
    // 只给概览一项，若把当时的标题存进 state，之后就会一直显示错的（如把商品页
    // 标成「店铺概览」）。
    const text = menuDriven
      ? (matchMenu(menuItems, tab.path)?.label ?? tab.name)
      : intl.formatMessage({ id: tab.name, defaultMessage: tab.path });
    const count = badges?.[tab.path] ?? 0;
    return (
      <span>
        {text}
        {count > 0 ? (
          <Badge count={count} size="small" style={{ marginInlineStart: 6 }} />
        ) : null}
      </span>
    );
  };

  const items = tabs.map((tab) => ({
    key: tab.path,
    label: labelOf(tab),
    closable: tab.closable,
  }));

  return (
    <div
      className="page-tabs-bar"
      data-testid="page-tabs"
      style={{
        background: token.colorBgContainer,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        padding: '8px 16px 0',
      }}
    >
      <Tabs
        size="small"
        type="editable-card"
        hideAdd
        activeKey={path}
        items={items}
        onChange={(key) => history.push(key)}
        onEdit={(targetKey, action) => {
          if (action === 'remove' && typeof targetKey === 'string') {
            closeTab(targetKey);
          }
        }}
        tabBarExtraContent={
          <Button
            type="text"
            size="small"
            icon={<CloseCircleOutlined />}
            disabled={tabs.length <= 1}
            onClick={closeAll}
            data-testid="page-tabs-close-all"
          >
            关闭全部
          </Button>
        }
        style={{ marginBottom: 0 }}
      />
    </div>
  );
};

export default PageTabs;
