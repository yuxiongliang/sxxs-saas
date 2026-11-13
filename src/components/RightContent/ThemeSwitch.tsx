import { BulbFilled, BulbOutlined, DesktopOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { Button } from 'antd';
import React from 'react';
import type { ThemeMode } from '@/theme';
import { useAppTheme } from '@/theme';
import HeaderDropdown from '../HeaderDropdown';
import useHeaderActionStyles from './style';

const THEME_OPTIONS: Array<{
  key: ThemeMode;
  label: string;
  icon: React.ReactNode;
}> = [
  { key: 'light', label: '亮色', icon: <BulbOutlined /> },
  { key: 'dark', label: '暗色', icon: <BulbFilled /> },
  { key: 'system', label: '跟随系统', icon: <DesktopOutlined /> },
];

/**
 * 三态主题切换（亮色 / 暗色 / 跟随系统）。
 *
 * 状态由 `AppThemeProvider` 统一持有并写进 localStorage，这里只是入口；
 * 和公开站头部用的是同一套 `useAppTheme`，切了之后两边一致。
 */
export const ThemeSwitch: React.FC = () => {
  const { styles } = useHeaderActionStyles();
  const { mode, setMode } = useAppTheme();
  const active =
    THEME_OPTIONS.find((item) => item.key === mode) ?? THEME_OPTIONS[2];

  const items: MenuProps['items'] = THEME_OPTIONS.map((option) => ({
    key: option.key,
    icon: option.icon,
    label: option.label,
  }));

  return (
    <HeaderDropdown
      placement="bottomRight"
      arrow
      menu={{
        items,
        selectable: true,
        selectedKeys: [mode],
        onClick: ({ key }) => setMode(key as ThemeMode),
        style: { minWidth: 120 },
      }}
    >
      <Button
        type="text"
        className={styles.action}
        // 无障碍名称说明「当前是哪种模式」，而不是只给一个图标
        aria-label={`主题：${active.label}`}
        title={`主题：${active.label}`}
        icon={active.icon}
      />
    </HeaderDropdown>
  );
};

export default ThemeSwitch;
