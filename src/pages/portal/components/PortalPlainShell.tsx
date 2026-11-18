import { useModel } from '@umijs/max';
import { Space } from 'antd';
import type React from 'react';
import { useEffect } from 'react';
import { UserMenu } from '@/components';
import { LangDropdown } from '@/components/RightContent/LangDropdown';
import ThemeSwitch from '@/components/RightContent/ThemeSwitch';
import PortalBrand, { PORTAL_HEADER_HEIGHT } from './PortalBrand';

/**
 * 精简外壳：只有顶栏，**不带侧栏**。
 *
 * 给「流程结束类」页面用（目前是支付结果页）：挂上侧栏会诱使用户中途跳走，
 * 也会把「支付成功 → 查看订单」这条单线流程打散。
 */
const PortalPlainShell: React.FC<{
  children: React.ReactNode;
  title?: string;
}> = ({ children, title }) => {
  const { initialState } = useModel('@@initialState');
  const brand = initialState?.brand;

  // 与 PortalLayout 一致：面包屑不挂在顶栏，`title` 用作浏览器标签页标题
  useEffect(() => {
    const site = brand?.display_name;
    document.title = title
      ? site
        ? `${title} - ${site}`
        : title
      : site || document.title;
  }, [title, brand?.display_name]);

  return (
    <div
      style={{ minHeight: '100vh', background: 'var(--ant-color-bg-layout)' }}
    >
      <div
        style={{
          background: 'var(--ant-color-bg-container)',
          borderBottom: '1px solid var(--ant-color-border-secondary)',
          padding: '0 16px',
          height: PORTAL_HEADER_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Space size={12}>
          <PortalBrand brand={brand} />
          {title ? (
            <span style={{ color: 'var(--ant-color-text-tertiary)' }}>
              {title}
            </span>
          ) : null}
        </Space>
        <Space size={12}>
          <LangDropdown />
          <ThemeSwitch />
          <UserMenu
            name={initialState?.currentUser?.name}
            testId="plain-user-menu"
          />
        </Space>
      </div>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
        {children}
      </div>
    </div>
  );
};

export default PortalPlainShell;
