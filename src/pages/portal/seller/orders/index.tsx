import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Card,
  Form,
  Image,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMemo, useState } from 'react';
import {
  listSellerOrders,
  refundMySellerOrder,
  rejectMySellerOrderRefund,
  shipMySellerOrder,
} from '@/services/commerce/api';
import type {
  OrderItemRecord,
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
import SellerShell from '../components/SellerShell';

const money = (cents?: number | null) =>
  typeof cents === 'number' ? `¥${(cents / 100).toFixed(2)}` : '—';

/**
 * 一行 = 一个商品行。卖家最关心「我卖了什么、发到哪一步」，
 * 原来只回金额，卖家完全看不到商品，只能去问运营。
 */
type SellerOrderRow = {
  key: string;
  order: SellerOrderRecord;
  item?: OrderItemRecord;
  first: boolean;
  rowSpan: number;
};

/** 我的订单（卖家侧）：查看子订单并处理发货。 */
export default function SellerOrdersPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [shipOpen, setShipOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<SellerOrderRecord>();
  const [shipForm] = Form.useForm();

  const orders = useQuery({
    queryKey: ['seller-orders'],
    queryFn: () => listSellerOrders(),
  });

  const rows: SellerOrderRow[] = useMemo(() => {
    const result: SellerOrderRow[] = [];
    for (const order of orders.data ?? []) {
      const items = order.items ?? [];
      if (items.length === 0) {
        result.push({ key: `${order.id}`, order, first: true, rowSpan: 1 });
        continue;
      }
      items.forEach((item, index) => {
        result.push({
          key: `${order.id}-${item.id}`,
          order,
          item,
          first: index === 0,
          rowSpan: items.length,
        });
      });
    }
    return result;
  }, [orders.data]);

  const handleShip = async () => {
    if (!selectedOrder) return;
    const values = await shipForm.validateFields();
    await shipMySellerOrder(selectedOrder.id, values);
    message.success('发货成功');
    setShipOpen(false);
    shipForm.resetFields();
    queryClient.invalidateQueries({ queryKey: ['seller-orders'] });
    queryClient.invalidateQueries({ queryKey: ['seller-profile'] });
  };

  const merge = (record: SellerOrderRow) => ({
    rowSpan: record.first ? record.rowSpan : 0,
  });

  const columns: ColumnsType<SellerOrderRow> = [
    {
      title: '卖家单号',
      width: 180,
      onCell: merge,
      render: (_, record) => (
        <span style={{ fontWeight: 600 }}>{record.order.seller_order_no}</span>
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
      render: (_, record) => {
        // 发货地 = 商品所在地快照；与收货城市一致就标「同城」，便于判断时效
        const location = record.item?.location;
        const receiverCity = record.order.receiver_city;
        const sameCity =
          Boolean(location) &&
          Boolean(receiverCity) &&
          record.item?.location_city === receiverCity;
        return (
          <div>
            <div>{record.item?.product_name ?? '—'}</div>
            <div
              style={{ fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}
            >
              发货地：{location || '—'}
              {location && receiverCity ? (
                <Tag
                  style={{ marginInlineStart: 6 }}
                  color={sameCity ? 'green' : 'orange'}
                >
                  {sameCity ? '同城' : '跨城'}
                </Tag>
              ) : null}
            </div>
          </div>
        );
      },
    },
    {
      title: '商品规格',
      width: 160,
      render: (_, record) => record.item?.sku_name ?? '—',
    },
    {
      title: '单价',
      width: 100,
      render: (_, record) => money(record.item?.price_cents),
    },
    {
      title: '数量',
      width: 80,
      render: (_, record) => record.item?.quantity ?? '—',
    },
    {
      title: '小计',
      width: 100,
      render: (_, record) => money(record.item?.subtotal_cents),
    },
    {
      // 金额是卖家单级口径：合并单元格不参与求和，避免重复累加
      title: '商品金额',
      width: 110,
      onCell: merge,
      render: (_, record) => money(record.order.goods_amount_cents),
    },
    {
      title: '佣金',
      width: 100,
      onCell: merge,
      render: (_, record) => money(record.order.commission_amount_cents),
    },
    {
      title: '应结算',
      width: 110,
      onCell: merge,
      render: (_, record) => money(record.order.payable_to_seller_cents),
    },
    {
      title: '交付方式',
      width: 100,
      onCell: merge,
      render: (_, record) => (
        <Tag>
          {DELIVERY_METHOD[record.order.delivery_method ?? 'express'] ??
            record.order.delivery_method}
        </Tag>
      ),
    },
    {
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
      // 时间口径由服务端算好：发货超时**只提醒，不自动处罚**
      title: '时效',
      width: 180,
      onCell: merge,
      render: (_, record) => {
        const order = record.order;
        if (order.fulfillment_status === 'to_ship' && order.ship_deadline_at) {
          const deadline = new Date(order.ship_deadline_at).getTime();
          const overdue = deadline < Date.now();
          return (
            <Typography.Text
              type={overdue ? 'danger' : 'secondary'}
              style={{ fontSize: 12 }}
            >
              {overdue
                ? '已超出发货时限'
                : `需在 ${formatDateTime(order.ship_deadline_at)} 前发货`}
            </Typography.Text>
          );
        }
        if (order.fulfillment_status === 'shipped' && order.auto_confirm_at) {
          return (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              预计 {formatDateTime(order.auto_confirm_at)} 自动确认
            </Typography.Text>
          );
        }
        return '—';
      },
    },
    {
      title: '操作',
      width: 160,
      fixed: 'right',
      render: (_, record) => (
        <Space size={0} wrap>
          {/* 快递 → 填运单号发货；自提 → 一键「备货完成」（不需要运单号） */}
          {record.order.fulfillment_status === 'to_ship' ? (
            <Button
              type="link"
              size="small"
              onClick={() => {
                setSelectedOrder(record.order);
                setShipOpen(true);
              }}
            >
              {record.order.delivery_method === 'pickup' ? '备货完成' : '发货'}
            </Button>
          ) : null}
          {/* 买家申请售后（退款中）→ 卖家同意或驳回 */}
          {record.order.payment_status === 'refunding' ? (
            <>
              <Button
                type="link"
                size="small"
                onClick={async () => {
                  await refundMySellerOrder(record.order.id, {
                    amount_cents: record.order.goods_amount_cents,
                    reason: '卖家同意退款',
                  });
                  message.success('已退款');
                  queryClient.invalidateQueries({
                    queryKey: ['seller-orders'],
                  });
                }}
              >
                同意退款
              </Button>
              <Button
                type="link"
                size="small"
                danger
                onClick={async () => {
                  await rejectMySellerOrderRefund(record.order.id, '卖家驳回');
                  message.success('已驳回售后申请');
                  queryClient.invalidateQueries({
                    queryKey: ['seller-orders'],
                  });
                }}
              >
                驳回
              </Button>
            </>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <SellerShell title="我的订单">
      <Card>
        <Table<SellerOrderRow>
          rowKey="key"
          loading={orders.isLoading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1560 }}
          pagination={{ defaultPageSize: 20, showSizeChanger: true }}
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
            <Input />
          </Form.Item>
          <Form.Item
            label="运单号"
            name="tracking_no"
            rules={[{ required: true, message: '请输入运单号' }]}
          >
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </SellerShell>
  );
}
