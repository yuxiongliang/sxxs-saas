import { ShopOutlined, UserOutlined } from '@ant-design/icons';
import { Link, useModel } from '@umijs/max';
import { Space } from 'antd';
import type React from 'react';

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

  return (
    <div
      style={{ minHeight: '100vh', background: 'var(--ant-color-bg-layout)' }}
    >
      <div
        style={{
          background: 'var(--ant-color-bg-container)',
          borderBottom: '1px solid var(--ant-color-border-secondary)',
          padding: '0 16px',
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Space size={12}>
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
        <span
          style={{ fontSize: 13, color: 'var(--ant-color-text-secondary)' }}
        >
          <UserOutlined /> {initialState?.currentUser?.name || '买家'}
        </span>
      </div>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
        {children}
      </div>
    </div>
  );
};

export default PortalPlainShell;
