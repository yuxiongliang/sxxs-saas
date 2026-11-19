import { ShopOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Input, Space, Spin, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { SELLER_MENU } from '@/pages/portal/components/menuConfig';
import PortalLayout from '@/pages/portal/components/PortalLayout';
import { applySeller, getSellerApplication } from '@/services/commerce/api';

/**
 * 卖家中心的外壳 + 开店态守卫。
 *
 * 卖家中心是**独立页面**（与买家中心各一套侧栏），所以这里统一：
 * 1. 包 `PortalLayout`（侧栏 = SELLER_MENU，底部给「返回买家中心」）；
 * 2. 处理三种开店态——未开店先申请、审核中给提示、通过才渲染子页面。
 *
 * 未开店/审核中时侧栏只剩「店铺概览」一项：其它入口点进去也是空页面，
 * 不如不给。
 */
export default function SellerShell({
  children,
  title,
  narrow = false,
}: {
  children: ReactNode;
  title: string;
  /** 表单/阅读类页面收窄到 960；默认铺满 */
  narrow?: boolean;
}) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [shopName, setShopName] = useState('');
  const [applying, setApplying] = useState(false);

  const applicationQuery = useQuery({
    queryKey: ['seller-application'],
    queryFn: getSellerApplication,
    retry: false,
  });
  const application = applicationQuery.data;
  const ready =
    Boolean(application?.has_seller) && application?.status !== 'pending';

  const handleApply = async () => {
    if (shopName.trim().length < 2) {
      message.error('店铺名至少 2 个字');
      return;
    }
    setApplying(true);
    try {
      await applySeller({ shop_name: shopName.trim() });
      message.success('申请已提交，等待平台审核');
      await queryClient.invalidateQueries({ queryKey: ['seller-application'] });
    } catch (error) {
      message.error((error as Error)?.message || '申请失败');
    } finally {
      setApplying(false);
    }
  };

  return (
    <PortalLayout
      menu={ready ? SELLER_MENU : SELLER_MENU.slice(0, 1)}
      sectionLabel="卖家中心"
      title={title}
      narrow={narrow}
      switchLink={{ label: '返回买家中心', href: '/portal' }}
    >
      {applicationQuery.isLoading ? (
        <div style={{ padding: 48, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : !application?.has_seller ? (
        <Card title="申请成为店主" data-testid="seller-apply">
          <Space orientation="vertical" size={12} style={{ width: '100%' }}>
            <Typography.Text type="secondary">
              你目前是买家。开一家自己的店即可在同一套页面里管理商品、订单与结算。
            </Typography.Text>
            <Input
              placeholder="店铺名称（例如：阿强的二手键盘铺）"
              value={shopName}
              onChange={(event) => setShopName(event.target.value)}
              maxLength={64}
            />
            <Button type="primary" loading={applying} onClick={handleApply}>
              提交开店申请
            </Button>
          </Space>
        </Card>
      ) : application.status === 'pending' ? (
        <Alert
          type="info"
          showIcon
          icon={<ShopOutlined />}
          title="开店申请审核中"
          description="平台审核通过后，这里会变成你的店铺管理页（商品 / 订单 / 结算）。"
          data-testid="seller-pending"
        />
      ) : (
        children
      )}
    </PortalLayout>
  );
}
