import { CustomerServiceOutlined, ShopOutlined } from '@ant-design/icons';
import { useModel } from '@umijs/max';
import { App, Avatar, Button, Card, Divider, Space, Typography } from 'antd';
import { useState } from 'react';
import type { PublicProduct } from '@/services/commerce/api';
import { createConversation } from '@/services/im/api';

/**
 * 商品详情页右侧的「店铺信息」卡。
 *
 * 口径（本轮定稿）：
 * * **头像用店铺 logo**（`users` 表没有头像字段）；没有 logo 时用店铺名首字生成色块，不留空框；
 * * **只显示用户名**，不显示 `usr_xxx` —— 那是运营排查用的编号，对买家没意义
 *   （这是全站「用户ID + 用户名」口径的**买家侧例外**）；
 * * 全站名称取租户品牌名（`tenants.display_name`）；
 * * 「在线客服」复用现成 IM：按 `seller_id` 建/取会话后跳 `/im`；
 * * 「进店逛逛」按钮**先做好但不跳转**（店铺主页这一轮不做），点了给出明确提示，
 *   不留一个点了没反应的死按钮。
 */
export default function ShopCard({ product }: { product: PublicProduct }) {
  const { message } = App.useApp();
  const { initialState } = useModel('@@initialState');
  const [opening, setOpening] = useState(false);
  const signedIn = Boolean(initialState?.currentUser);

  const shopName = product.shop_name || '店铺';
  const initial = shopName.trim().slice(0, 1).toUpperCase();

  const openCustomerService = async () => {
    if (!signedIn) {
      window.location.assign(
        `/user/login?redirect=${encodeURIComponent(`/products/${product.id}`)}`,
      );
      return;
    }
    setOpening(true);
    try {
      const conversation = await createConversation({
        seller_id: product.seller_id,
      });
      window.location.assign(
        `/im?conversation=${encodeURIComponent(String(conversation.id))}`,
      );
    } catch (error) {
      message.error((error as Error)?.message || '打开会话失败');
    } finally {
      setOpening(false);
    }
  };

  return (
    <Card data-testid="shop-card" size="small">
      <Space size={12} align="start" style={{ width: '100%' }}>
        <Avatar
          size={56}
          shape="square"
          src={product.shop_logo || undefined}
          icon={!product.shop_logo ? <ShopOutlined /> : undefined}
          style={{
            flex: '0 0 auto',
            background: product.shop_logo
              ? undefined
              : 'var(--ant-color-primary-bg)',
            color: 'var(--ant-color-primary)',
            fontSize: 22,
          }}
        >
          {!product.shop_logo ? initial : null}
        </Avatar>
        <div style={{ minWidth: 0, flex: 1 }}>
          <Typography.Text strong ellipsis style={{ display: 'block' }}>
            {shopName}
          </Typography.Text>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 12, display: 'block' }}
            ellipsis
            data-testid="shop-owner-username"
          >
            {/* 只看用户名，不带 usr_ 编号 */}
            {product.seller_username || '卖家'}
          </Typography.Text>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 12, display: 'block' }}
            ellipsis
            data-testid="shop-tenant-name"
          >
            {product.tenant_name || '—'}
          </Typography.Text>
        </div>
      </Space>

      <Divider style={{ margin: '12px 0' }} />

      <div style={{ fontSize: 12 }}>
        <Typography.Text type="secondary">客服：</Typography.Text>
        <Typography.Link
          data-testid="shop-customer-service"
          onClick={openCustomerService}
        >
          <CustomerServiceOutlined /> {opening ? '正在打开…' : '在线客服'}
        </Typography.Link>
      </div>

      <Button
        block
        type="primary"
        ghost
        style={{ marginTop: 12 }}
        data-testid="shop-visit"
        onClick={() => {
          // 店铺主页尚未上线：明确告诉用户，而不是放一个点了没反应的按钮
          message.info('店铺主页正在建设中，敬请期待');
        }}
      >
        进店逛逛
      </Button>
    </Card>
  );
}
