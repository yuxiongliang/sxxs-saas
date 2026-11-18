import { ProfileOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  App,
  Button,
  Card,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useMemo, useState } from 'react';
import ListToolbar from '@/components/ListToolbar';
import {
  cancelOrder,
  listAdminOrders,
  mockPayOrder,
  refundSellerOrder,
  shipSellerOrder,
} from '@/services/commerce/api';
import type {
  OrderItemRecord,
  OrderRecord,
  SellerOrderRecord,
} from '@/services/commerce/types';
import { formatDateTime } from '@/utils/datetime';
import {
  DELIVERY_METHOD,
  FULFILLMENT_STATUS,
  FULFILLMENT_STATUS_COLOR,
  labelOf,
  PAYMENT_STATUS,
  PAYMENT_STATUS_COLOR,
  PRODUCT_TYPE,
  PRODUCT_TYPE_COLOR,
} from '@/utils/labels';
import SettingPage from '../../system/components/SettingPage';

const money = (cents?: number | null) =>
  typeof cents === 'number' ? `¥${(cents / 100).toFixed(2)}` : '—';

/**
 * 时间按**浏览器本地时区**展示。
 *
 * 之前是 `value.replace('T',' ').slice(0,16)` —— 后端返回的是带 `+00:00` 的 UTC，
 * 直接截字符串会让显示时间比北京时间少 8 小时；倒计时/计划时间照抄就更离谱。
 */

/**
 * 一行 = 一个商品行（`order_items`），不是一个订单。
 *
 * 为什么：运营在订单列表上要回答的核心问题是「这一单卖了什么、发到哪一步」，
 * 原来只回订单头，必须点开抽屉才知道商品，一屏只能处理一单。
 * 一行一商品后，配合横向滚动，整单信息在一屏内看完。
 *
 * 订单级字段（用户ID/买家/订单号/金额/状态/时间）用 `rowSpan` 合并，
 * 只在第一行渲染、并**不做金额合计** —— 合并单元格参与求和会把订单金额算重。
 */
type OrderRow = {
  /** 行 key：订单 id + 商品行 id，商品行可能为空（老数据/空订单） */
  key: string;
  order: OrderRecord;
  item?: OrderItemRecord;
  /** 这一行商品所属的卖家单（发货/退款是卖家单粒度） */
  sellerOrder?: SellerOrderRecord;
  /** 该订单第一行：只有它渲染订单级信息与订单级操作 */
  first: boolean;
  rowSpan: number;
};

const OrderManagementPage: React.FC = () => {
  const { message } = App.useApp();
  const [shipOpen, setShipOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [selected, setSelected] = useState<SellerOrderRecord>();
  const [shipForm] = Form.useForm();
  const [refundForm] = Form.useForm();
  const [keyword, setKeyword] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<string>();
  const [fulfillmentStatus, setFulfillmentStatus] = useState<string>();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-orders', keyword, paymentStatus, fulfillmentStatus],
    queryFn: () =>
      listAdminOrders({
        keyword: keyword || undefined,
        payment_status: paymentStatus,
        fulfillment_status: fulfillmentStatus,
      }),
  });

  const rows: OrderRow[] = useMemo(() => {
    const result: OrderRow[] = [];
    for (const order of data ?? []) {
      const items = order.items ?? [];
      const sellerOrderById = new Map(
        (order.seller_orders ?? []).map((item) => [item.id, item]),
      );
      if (items.length === 0) {
        result.push({
          key: `${order.id}`,
          order,
          first: true,
          rowSpan: 1,
        });
        continue;
      }
      items.forEach((item, index) => {
        result.push({
          key: `${order.id}-${item.id}`,
          order,
          item,
          sellerOrder: item.seller_order_id
            ? sellerOrderById.get(item.seller_order_id)
            : undefined,
          first: index === 0,
          rowSpan: items.length,
        });
      });
    }
    return result;
  }, [data]);

  const handleShip = async () => {
    if (!selected) return;
    const values = await shipForm.validateFields();
    await shipSellerOrder(selected.id, {
      carrier: values.carrier,
      tracking_no: values.tracking_no,
    });
    message.success('已发货');
    setShipOpen(false);
    shipForm.resetFields();
    await refetch();
  };

  const handleRefund = async () => {
    if (!selected) return;
    const values = await refundForm.validateFields();
    await refundSellerOrder(selected.id, {
      amount_cents: Math.round(values.amount * 100),
      reason: values.reason,
    });
    message.success('退款成功');
    setRefundOpen(false);
    refundForm.resetFields();
    // 刷新**列表**：原来刷的是抽屉里的详情，抽屉去掉后必须刷列表，
    // 否则界面不动、用户以为没生效
    await refetch();
  };

  /** 订单级单元格：合并到该订单的所有商品行 */
  const merge = (record: OrderRow) => ({
    rowSpan: record.first ? record.rowSpan : 0,
  });

  const columns: ColumnsType<OrderRow> = [
    {
      // 全站规则：买家给「用户ID + 用户名」，不显示裸 buyer_id
      title: '用户ID',
      width: 210,
      onCell: merge,
      render: (_, record) =>
        record.order.buyer_public_id ? (
          <Typography.Text
            code
            copyable={{ text: record.order.buyer_public_id }}
          >
            {record.order.buyer_public_id}
          </Typography.Text>
        ) : (
          '—'
        ),
    },
    {
      title: '买家',
      width: 130,
      onCell: merge,
      render: (_, record) => record.order.buyer_username ?? '—',
    },
    {
      title: '订单号',
      dataIndex: ['order', 'order_no'],
      width: 190,
      onCell: merge,
      render: (value: string) => (
        <span style={{ fontWeight: 600 }}>{value}</span>
      ),
    },
    {
      title: '商品类型',
      width: 110,
      render: (_, record) => {
        const type = record.item?.product_type ?? 'physical';
        return (
          <Tag color={PRODUCT_TYPE_COLOR[type] ?? 'default'}>
            {PRODUCT_TYPE[type] ?? type}
          </Tag>
        );
      },
    },
    {
      title: '商品图片',
      width: 90,
      render: (_, record) =>
        record.item?.image ? (
          <Image
            src={record.item.image}
            alt={record.item.product_name}
            width={56}
            height={56}
            style={{ objectFit: 'cover', borderRadius: 6 }}
          />
        ) : (
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 6,
              background: 'var(--ant-color-fill-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              color: 'var(--ant-color-text-tertiary)',
            }}
          >
            无图
          </div>
        ),
    },
    {
      title: '商品名称',
      width: 220,
      render: (_, record) => record.item?.product_name ?? '—',
    },
    {
      title: '商品规格',
      width: 180,
      render: (_, record) => record.item?.sku_name ?? '—',
    },
    {
      title: '单价',
      width: 110,
      render: (_, record) => money(record.item?.price_cents),
    },
    {
      title: '数量',
      width: 80,
      render: (_, record) => record.item?.quantity ?? '—',
    },
    {
      title: '小计',
      width: 110,
      render: (_, record) => money(record.item?.subtotal_cents),
    },
    {
      // 订单级金额**不做合计**：合并单元格参与求和会把同一金额重复累加
      title: '订单金额',
      width: 120,
      onCell: merge,
      render: (_, record) => money(record.order.payable_amount_cents),
    },
    {
      // 支付状态（钱）：待支付 / 已支付 / 退款中 / 部分退款 / 已退款 / 已取消
      title: '支付状态',
      width: 110,
      onCell: merge,
      render: (_, record) => (
        <Tag
          color={PAYMENT_STATUS_COLOR[record.order.payment_status] ?? 'default'}
        >
          {labelOf(PAYMENT_STATUS, record.order.payment_status)}
        </Tag>
      ),
    },
    {
      // 履约状态（货）：待付款 / 待发货 / 已发货 / 已完成 / 已取消
      title: '订单状态',
      width: 110,
      onCell: merge,
      render: (_, record) => (
        <Tag
          color={
            FULFILLMENT_STATUS_COLOR[record.order.fulfillment_status] ??
            'default'
          }
        >
          {labelOf(FULFILLMENT_STATUS, record.order.fulfillment_status)}
        </Tag>
      ),
    },
    {
      title: '交付方式',
      width: 100,
      render: (_, record) => {
        const method = record.item?.delivery_method ?? 'express';
        return <Tag>{DELIVERY_METHOD[method] ?? method}</Tag>;
      },
    },
    {
      title: '下单时间',
      width: 150,
      onCell: merge,
      render: (_, record) => formatDateTime(record.order.created_at),
    },
    {
      title: '操作',
      width: 200,
      fixed: 'right',
      render: (_, record) => {
        const sellerOrder = record.sellerOrder;
        return (
          <Space size={0} wrap>
            {/* 订单级操作只在首行出现，避免同一订单重复出现「模拟支付」 */}
            {record.first && record.order.payment_status === 'unpaid' ? (
              <>
                <Button
                  type="link"
                  size="small"
                  onClick={async () => {
                    await mockPayOrder(record.order.id);
                    message.success('模拟支付成功');
                    refetch();
                  }}
                >
                  模拟支付
                </Button>
                <Button
                  type="link"
                  size="small"
                  danger
                  onClick={async () => {
                    await cancelOrder(record.order.id);
                    message.success('订单已取消');
                    refetch();
                  }}
                >
                  取消
                </Button>
              </>
            ) : null}
            {/* 发货/退款是**卖家单粒度**：按本行商品所属的卖家单来，不能拿订单 id 去发货 */}
            {sellerOrder && sellerOrder.fulfillment_status === 'to_ship' ? (
              <Button
                type="link"
                size="small"
                onClick={() => {
                  setSelected(sellerOrder);
                  setShipOpen(true);
                }}
              >
                发货
              </Button>
            ) : null}
            {sellerOrder &&
            ['paid', 'refunding'].includes(sellerOrder.payment_status) ? (
              <Button
                type="link"
                size="small"
                danger
                onClick={() => {
                  setSelected(sellerOrder);
                  refundForm.setFieldsValue({
                    amount: sellerOrder.goods_amount_cents / 100,
                  });
                  setRefundOpen(true);
                }}
              >
                退款
              </Button>
            ) : null}
          </Space>
        );
      },
    },
  ];

  return (
    <SettingPage
      title="订单管理"
      subTitle="C2C 市场订单与卖家拆单"
      icon={<ProfileOutlined />}
      extra={
        <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
          刷新
        </Button>
      }
    >
      <Card>
        <ListToolbar
          searchPlaceholder="搜订单号 / 买家用户名 / 用户ID"
          keyword={keyword}
          onKeywordChange={setKeyword}
          onRefresh={() => refetch()}
          filters={
            <>
              <Select
                allowClear
                placeholder="支付状态"
                style={{ width: 140 }}
                value={paymentStatus}
                onChange={setPaymentStatus}
                options={Object.entries(PAYMENT_STATUS).map(
                  ([value, label]) => ({
                    label,
                    value,
                  }),
                )}
              />
              <Select
                allowClear
                placeholder="订单状态"
                style={{ width: 140 }}
                value={fulfillmentStatus}
                onChange={setFulfillmentStatus}
                options={Object.entries(FULFILLMENT_STATUS).map(
                  ([value, label]) => ({ label, value }),
                )}
              />
            </>
          }
        />
        <Table<OrderRow>
          rowKey="key"
          loading={isLoading}
          columns={columns}
          dataSource={rows}
          // 列多就让用户左右滑，不折行、不隐藏 —— 一屏看完比"清爽"重要
          scroll={{ x: 1980 }}
          pagination={{ defaultPageSize: 20, showSizeChanger: true }}
          expandable={{
            // 展开看卖家拆单与佣金：这是"不跳抽屉也要看完"的补充信息，
            // 商品与金额已经在主表行内
            expandedRowRender: (record) => (
              <Table<SellerOrderRecord>
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={record.order.seller_orders ?? []}
                columns={[
                  { title: '卖家单 ID', dataIndex: 'id', width: 100 },
                  {
                    title: '卖家',
                    width: 200,
                    render: (_, row) => (
                      <Space orientation="vertical" size={0}>
                        <span style={{ fontWeight: 600 }}>
                          {row.seller_username ?? '—'}
                        </span>
                        <span
                          style={{
                            color: 'var(--ant-color-text-secondary)',
                            fontSize: 12,
                          }}
                        >
                          {row.seller_name ?? `卖家 #${row.seller_id}`}
                        </span>
                      </Space>
                    ),
                  },
                  {
                    title: '支付状态',
                    dataIndex: 'payment_status',
                    width: 110,
                    render: (value: string) => (
                      <Tag color={PAYMENT_STATUS_COLOR[value] ?? 'default'}>
                        {labelOf(PAYMENT_STATUS, value)}
                      </Tag>
                    ),
                  },
                  {
                    title: '订单状态',
                    dataIndex: 'fulfillment_status',
                    width: 110,
                    render: (value: string) => (
                      <Tag color={FULFILLMENT_STATUS_COLOR[value] ?? 'default'}>
                        {labelOf(FULFILLMENT_STATUS, value)}
                      </Tag>
                    ),
                  },
                  {
                    title: '交付方式',
                    dataIndex: 'delivery_method',
                    width: 100,
                    render: (value: string) => (
                      <Tag>{DELIVERY_METHOD[value] ?? value}</Tag>
                    ),
                  },
                  {
                    title: '商品金额',
                    dataIndex: 'goods_amount_cents',
                    width: 120,
                    render: (value: number) => money(value),
                  },
                  {
                    title: '佣金',
                    dataIndex: 'commission_amount_cents',
                    width: 110,
                    render: (value: number) => money(value),
                  },
                  {
                    title: '应付卖家',
                    dataIndex: 'payable_to_seller_cents',
                    width: 120,
                    render: (value: number) => money(value),
                  },
                ]}
              />
            ),
          }}
        />
      </Card>

      <Modal
        title="卖家发货"
        open={shipOpen}
        onCancel={() => setShipOpen(false)}
        onOk={handleShip}
        destroyOnHidden
      >
        <Form form={shipForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="物流公司"
            name="carrier"
            rules={[{ required: true, message: '请输入物流公司' }]}
          >
            <Input placeholder="顺丰 / 中通 / 圆通" />
          </Form.Item>
          <Form.Item
            label="运单号"
            name="tracking_no"
            rules={[{ required: true, message: '请输入运单号' }]}
          >
            <Input placeholder="SF123456789" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="订单退款"
        open={refundOpen}
        onCancel={() => setRefundOpen(false)}
        onOk={handleRefund}
        destroyOnHidden
      >
        <Form form={refundForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="退款金额（元）"
            name="amount"
            rules={[{ required: true, message: '请输入退款金额' }]}
          >
            <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="退款原因" name="reason">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </SettingPage>
  );
};

export default OrderManagementPage;
