import {
  LogoutOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { history, useModel } from '@umijs/max';
import type { MenuProps } from 'antd';
import { App, Dropdown } from 'antd';
import React, { startTransition } from 'react';
import { logout as authLogout } from '@/services/auth/api';
import { clearAccessToken } from '@/utils/authToken';

/**
 * 当前用户名（鼠标悬停出菜单）—— 门户、商城、确认页统一用这一个。
 *
 * 以前同一个「用户名」在四个地方各写一遍：两个中心顶栏是纯文本、商城是点击下拉且
 * 只有退出、旧卖家页又是纯文本。用户想「进个人设置」得自己找路。
 *
 * 两条约定：
 * 1. **个人设置在新窗口打开** `/account/settings` —— 那个页面挂在租户控制台外壳里，
 *    同窗口打开会变成「门户外壳套控制台外壳」，还把购物/下单的工作现场顶掉。
 * 2. 退出登录**留在当前窗口**并回登录页（带 redirect，登完能回来）。
 */
export default function UserMenu({
  name,
  showIcon = true,
  testId = 'user-menu',
  children,
}: {
  name?: string | null;
  /** 是否显示人形图标（紧凑场景可关掉） */
  showIcon?: boolean;
  testId?: string;
  /** 自定义触发器（如商城顶栏的头像圆圈）；不传就用默认文本触发器 */
  children?: React.ReactNode;
}) {
  const { message } = App.useApp();
  const { setInitialState } = useModel('@@initialState');

  const items: MenuProps['items'] = [
    { key: 'settings', icon: <SettingOutlined />, label: '个人设置' },
    { type: 'divider' as const },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录' },
  ];

  const handleLogout = async () => {
    startTransition(() => {
      setInitialState((state) => ({ ...state, currentUser: undefined }));
    });
    try {
      await authLogout();
    } catch {
      // 后端退出失败也要清本地会话，否则页面会停在"看起来还登录着"
    } finally {
      clearAccessToken();
    }
    message.success('已退出登录');
    history.replace('/user/login');
  };

  const onClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'settings') {
      window.open('/account/settings', '_blank', 'noopener,noreferrer');
      return;
    }
    if (key === 'logout') {
      void handleLogout();
    }
  };

  return (
    <Dropdown
      menu={{ items, onClick }}
      // hover 是主交互；click 兜住触屏（hover 在手机上不触发）
      trigger={['hover', 'click']}
      placement="bottomRight"
    >
      {children ?? (
        <button
          type="button"
          data-testid={testId}
          title="个人设置 / 退出登录"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 6px',
            border: 'none',
            borderRadius: 6,
            background: 'transparent',
            color: 'var(--ant-color-text-secondary)',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          {showIcon ? <UserOutlined /> : null}
          {name || '未登录'}
        </button>
      )}
    </Dropdown>
  );
}
