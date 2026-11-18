import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@umijs/max';
import {
  App,
  Button,
  Card,
  Checkbox,
  Empty,
  InputNumber,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useMemo } from 'react';
import {
  clearPortalCart,
  deleteCartItem,
  getPortalCart,
  updateCartItem,
} from '@/services/commerce/api';
import type { CartItemRecord } from '@/services/commerce/types';
import PortalShell from '../components/PortalShell';

const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

const CartPage: React.FC = () => {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['portal-cart'],
    queryFn: getPortalCart,
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['portal-cart'] });
  };

  const selectedIds = useMemo(
    () =>
      (data?.items ?? [])
        .filter((item) => item.selected && item.available)
        .map((item) => item.id),
    [data],
  );

  const toggle = async (item: CartItemRecord, selected: boolean) => {
    await updateCartItem(item.id, { selected });
    await invalidate();
  };

  const changeQuantity = async (item: CartItemRecord, quantity: number) => {
    try {
      await updateCartItem(item.id, { quantity });
      await invalidate();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const remove = async (item: CartItemRecord) => {
    await deleteCartItem(item.id);
    message.success('已移出购物车');
    await invalidate();
  };

  /** 结算：跳到独立的订单确认页（弹窗已下线），商品清单/地址/支付都在那里。 */
  const goCheckout = () => {
    if (!selectedIds.length) {
      message.warning('请先勾选要结算的商品');
      return;
    }
    navigate('/portal/checkout?from=cart');
  };

  const columns: ColumnsType<CartItemRecord> = [
    {
      title: '',
      key: 'selected',
      width: 48,
      render: (_, record) => (
        <Checkbox
          checked={record.selected}
          disabled={!record.available}
          onChange={(event) => toggle(record, event.target.checked)}
        />
      ),
    },
    {
      title: '商品',
      key: 'product',
      render: (_, record) => (
        <Space orientation="vertical" size={2}>
          <Typography.Text strong>{record.product_name}</Typography.Text>
          <Typography.Text type="secondary">{record.sku_name}</Typography.Text>
          {!record.available ? <Tag color="red">已失效或库存不足</Tag> : null}
        </Space>
      ),
    },
    {
      title: '单价',
      key: 'price',
      width: 120,
      render: (_, record) => yuan(record.price_cents),
    },
    {
      title: '数量',
      key: 'quantity',
      width: 140,
      render: (_, record) => (
        <InputNumber
          min={1}
          max={Math.max(1, record.stock)}
          value={record.quantity}
          onChange={(value) => changeQuantity(record, value ?? 1)}
        />
      ),
    },
    {
      title: '小计',
      key: 'subtotal',
      width: 120,
      render: (_, record) => (
        <Typography.Text strong>{yuan(record.subtotal_cents)}</Typography.Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_, record) => (
        <Popconfirm title="移出购物车？" onConfirm={() => remove(record)}>
          <Button type="link" danger>
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <PortalShell title="购物车" cartCount={data?.total_count ?? 0}>
      <Card
        title={`购物车（${data?.total_count ?? 0}）`}
        extra={
          <Space>
            <Button
              onClick={async () => {
                await clearPortalCart();
                message.success('购物车已清空');
                await invalidate();
              }}
              disabled={!data?.items?.length}
            >
              清空
            </Button>
          </Space>
        }
      >
        {!isLoading && !data?.items?.length ? (
          <Empty description="购物车还是空的">
            <Button type="primary" onClick={() => navigate('/portal')}>
              去逛逛
            </Button>
          </Empty>
        ) : (
          <Table
            rowKey="id"
            loading={isLoading}
            columns={columns}
            dataSource={data?.items ?? []}
            pagination={false}
          />
        )}
      </Card>

      <Card style={{ marginTop: 16 }}>
        <Space
          style={{ width: '100%', justifyContent: 'space-between' }}
          align="center"
        >
          <Space size={16}>
            <Typography.Text>
              已选{' '}
              <Typography.Text strong>
                {data?.selected_count ?? 0}
              </Typography.Text>{' '}
              件
            </Typography.Text>
            {data?.invalid_count ? (
              <Tag color="orange">{data.invalid_count} 件失效</Tag>
            ) : null}
          </Space>
          <Space size={16}>
            <Typography.Text>
              合计：
              <Typography.Text
                strong
                style={{ color: '#ff4d4f', fontSize: 20 }}
              >
                {yuan(data?.selected_amount_cents ?? 0)}
              </Typography.Text>
            </Typography.Text>
            <Button type="primary" size="large" onClick={goCheckout}>
              去结算
            </Button>
          </Space>
        </Space>
      </Card>
    </PortalShell>
  );
};

export default CartPage;
