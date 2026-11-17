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
import React, { useMemo, useState } from 'react';
import RegionCascader from '@/components/RegionCascader';
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
  // 手动填地址时的省市区前缀（选了已保存地址就不用它）
  const [manualRegion, setManualRegion] = useState('');
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
    setSubmitting(true);
    try {
      const order = await checkoutCart({
        delivery: checkedItems.map((item) => ({
          seller_id: item.seller_id,
          delivery_method: deliveryBySeller[item.seller_id] ?? 'express',
        })),
        receiver_name: address?.receiver_name ?? values.receiver_name,
        receiver_phone: address?.receiver_phone ?? values.receiver_phone,
        receiver_address: address
          ? {
              province: address.province,
              city: address.city,
              district: address.district,
              detail: address.detail,
            }
          : {
              detail: [manualRegion, values.receiver_address]
                .filter(Boolean)
                .join(' '),
            },
        address_id: values.address_id,
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
          {needsAddress ? (
            <>
              <Form.Item label="收货地址" name="address_id">
                <Select
                  allowClear
                  placeholder="选择已保存的地址（也可直接填写下方信息）"
                  options={(addresses ?? []).map((item) => ({
                    value: item.id,
                    label: `${item.is_default ? '[默认] ' : ''}${item.receiver_name} ${item.receiver_phone} ${item.province}${item.city}${item.detail}`,
                  }))}
                />
              </Form.Item>
              <Form.Item label="收货人" name="receiver_name">
                <Input placeholder="收货人姓名" />
              </Form.Item>
              <Form.Item label="联系电话" name="receiver_phone">
                <Input placeholder="手机号" />
              </Form.Item>
              <Form.Item label="省 / 市 / 区">
                <RegionCascader
                  onChange={(picked) => {
                    // 手动填地址时把省市区拼在 detail 前面（后端 receiver_address 只存 detail）
                    setManualRegion((picked ?? []).filter(Boolean).join(' '));
                  }}
                />
              </Form.Item>
              <Form.Item label="详细地址" name="receiver_address">
                <Input placeholder="街道、门牌号（未选择已保存地址时填写）" />
              </Form.Item>
            </>
          ) : (
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
              全部商品为自提，无需填写收货地址；请留下联系人姓名与手机号。
            </Typography.Paragraph>
          )}
          {!needsAddress ? (
            <>
              <Form.Item label="联系人" name="receiver_name">
                <Input placeholder="到店自提的联系人" />
              </Form.Item>
              <Form.Item label="联系电话" name="receiver_phone">
                <Input placeholder="手机号" />
              </Form.Item>
            </>
          ) : null}
          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={2} placeholder="选填" />
          </Form.Item>
        </Form>
        <Button type="link" onClick={() => navigate('/portal/addresses')}>
          管理收货地址
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
