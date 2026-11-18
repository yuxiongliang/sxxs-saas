import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@umijs/max';
import {
  App,
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useEffect, useMemo, useState } from 'react';
import {
  checkoutCart,
  clearPortalCart,
  deleteCartItem,
  getPortalCart,
  listAddresses,
  updateCartItem,
} from '@/services/commerce/api';
import type { CartItemRecord } from '@/services/commerce/types';
import PortalShell from '../components/PortalShell';

const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

const CartPage: React.FC = () => {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  // 一个订单可拆多个卖家单，交付方式按卖家各选一个（默认快递）
  const [deliveryBySeller, setDeliveryBySeller] = useState<
    Record<number, 'express' | 'pickup'>
  >({});
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({
    queryKey: ['portal-cart'],
    queryFn: getPortalCart,
  });
  const { data: addresses } = useQuery({
    queryKey: ['portal-addresses'],
    queryFn: listAddresses,
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['portal-cart'] });
  };

  // 「管理收货地址」在新窗口打开：用户回来自动刷新，弹窗里立刻能看到新地址
  useEffect(() => {
    const onFocus = () => {
      queryClient.invalidateQueries({ queryKey: ['portal-addresses'] });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [queryClient]);

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

  const openCheckout = () => {
    if (!selectedIds.length) {
      message.warning('请先勾选要结算的商品');
      return;
    }
    const preferred =
      addresses?.find((item) => item.is_default) ?? addresses?.[0];
    form.setFieldsValue({
      address_id: preferred?.id,
      receiver_name: preferred?.receiver_name ?? '',
      receiver_phone: preferred?.receiver_phone ?? '',
    });
    setCheckoutOpen(true);
  };

  const checkedItems = (data?.items ?? []).filter((item) =>
    selectedIds.includes(item.id),
  );
  const sellerGroups = useMemo(() => {
    const map = new Map<
      number,
      {
        sellerId: number;
        methods: string[];
        pickupAddress?: string;
        pickupNote?: string;
      }
    >();
    for (const item of checkedItems) {
      if (!map.has(item.seller_id)) {
        map.set(item.seller_id, {
          sellerId: item.seller_id,
          methods: item.delivery_methods ?? ['express'],
          pickupAddress: item.shop_address ?? undefined,
          pickupNote: item.shop_pickup_note ?? undefined,
        });
      }
    }
    return [...map.values()];
  }, [checkedItems]);
  const needsAddress = sellerGroups.some(
    (group) => (deliveryBySeller[group.sellerId] ?? 'express') === 'express',
  );

  const submitCheckout = async () => {
    const values = await form.validateFields();
    const address = addresses?.find((item) => item.id === values.address_id);
    if (!address) {
      message.warning('请选择收货地址');
      return;
    }
    setSubmitting(true);
    try {
      const order = await checkoutCart({
        delivery: checkedItems.map((item) => ({
          seller_id: item.seller_id,
          delivery_method: deliveryBySeller[item.seller_id] ?? 'express',
        })),
        // 收货人/电话/地址全部来自地址簿，不再有手填字段
        receiver_name: address.receiver_name,
        receiver_phone: address.receiver_phone,
        receiver_address: {
          province: address.province,
          city: address.city,
          district: address.district,
          detail: address.detail,
        },
        address_id: address.id,
        remark: values.remark,
      });
      await invalidate();
      setCheckoutOpen(false);
      message.success(`下单成功：${order.order_no}`);
      navigate(`/portal/payment-result?orderId=${order.id}`);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSubmitting(false);
    }
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
            <Button type="primary" size="large" onClick={openCheckout}>
              去结算
            </Button>
          </Space>
        </Space>
      </Card>

      <Modal
        title="确认订单"
        open={checkoutOpen}
        onCancel={() => setCheckoutOpen(false)}
        onOk={submitCheckout}
        confirmLoading={submitting}
        okText="提交订单"
      >
        <Form form={form} layout="vertical">
          {/* 交付方式按卖家分组：同一单可能一个卖家发快递、另一个自提 */}
          {sellerGroups.map((group) => (
            <Form.Item
              key={group.sellerId}
              label={`交付方式（卖家 #${group.sellerId}）`}
            >
              <Radio.Group
                value={deliveryBySeller[group.sellerId] ?? 'express'}
                onChange={(event) =>
                  setDeliveryBySeller((prev) => ({
                    ...prev,
                    [group.sellerId]: event.target.value,
                  }))
                }
              >
                <Radio.Button value="express">物流快递</Radio.Button>
                <Radio.Button
                  value="pickup"
                  disabled={
                    !group.methods.includes('pickup') || !group.pickupAddress
                  }
                >
                  自提
                </Radio.Button>
              </Radio.Group>
              {deliveryBySeller[group.sellerId] === 'pickup' ? (
                <Typography.Paragraph
                  type="secondary"
                  style={{ margin: '6px 0 0', fontSize: 12 }}
                >
                  自提点：{group.pickupAddress || '卖家未填写'}
                  {group.pickupNote ? ` · ${group.pickupNote}` : ''}
                </Typography.Paragraph>
              ) : null}
            </Form.Item>
          ))}
          {/* 只保留「收货地址」与「备注」：地址统一在地址簿里维护，
              这里不再手填姓名/电话/省市区/门牌——手填会造出和地址簿不一样的一套脏数据。
              自提单也用地址簿里的联系人+手机号作为到店联系信息。 */}
          <Form.Item
            label="收货地址"
            name="address_id"
            rules={[{ required: true, message: '请选择收货地址' }]}
            extra="地址在「收货地址」页面维护，保存后回来自动出现在这里"
          >
            <Select
              allowClear
              placeholder="选择已保存的地址"
              options={(addresses ?? []).map((item) => ({
                value: item.id,
                label: `${item.is_default ? '[默认] ' : ''}${item.receiver_name} ${item.receiver_phone} ${item.province}${item.city}${item.district}${item.detail}`,
              }))}
              notFoundContent="还没有收货地址，点下方「管理收货地址」新增"
            />
          </Form.Item>
          {needsAddress ? null : (
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
              本单全部为自提，用地址簿里的联系人/手机号作为到店联系方式。
            </Typography.Paragraph>
          )}
          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={2} placeholder="选填" />
          </Form.Item>
        </Form>
        <Button
          type="link"
          onClick={() => window.open('/portal/addresses', '_blank', 'noopener')}
        >
          管理收货地址（新窗口）
        </Button>
        <div style={{ marginTop: 8 }}>
          <Typography.Text type="secondary">
            提交订单后可在支付页完成模拟支付。
          </Typography.Text>
        </div>
      </Modal>
    </PortalShell>
  );
};

export default CartPage;
