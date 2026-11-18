import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@umijs/max';
import {
  App,
  Button,
  Card,
  Empty,
  Image,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  cancelPortalRefund,
  confirmPortalOrder,
  listPortalOrders,
  requestPortalRefund,
} from '@/services/commerce/api';
import type { OrderItemRecord, PortalOrder } from '@/services/commerce/types';
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
import PortalShell from '../components/PortalShell';

const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

// 状态配色已统一到 utils/labels（PAYMENT_STATUS_COLOR / FULFILLMENT_STATUS_COLOR）

/** 我的订单（从原 /portal 的 Tab 迁出为独立页面） */
export default function PortalOrdersPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['portal-orders'],
    queryFn: listPortalOrders,
  });
  const orders = data ?? [];

  /**
   * 一行一个商品。原来买家只能看到"某订单 ¥xxx"，必须点进详情才知道买了什么；
   * 订单级字段用 rowSpan 合并，商品信息逐行铺开。
   */
  type Row = {
    key: string;
    order: PortalOrder;
    item?: OrderItemRecord;
    first: boolean;
    rowSpan: number;
  };
  const rows: Row[] = [];
  for (const order of orders) {
    const items = order.items ?? [];
    if (items.length === 0) {
      rows.push({ key: `${order.id}`, order, first: true, rowSpan: 1 });
      continue;
    }
    items.forEach((item, index) => {
      rows.push({
        key: `${order.id}-${item.id}`,
        order,
        item,
        first: index === 0,
        rowSpan: items.length,
      });
    });
  }
  const merge = (record: Row) => ({
    rowSpan: record.first ? record.rowSpan : 0,
  });

  const columns: ColumnsType<Row> = [
    {
      title: '订单号',
      width: 190,
      onCell: merge,
      render: (_, record) => (
        <span style={{ fontWeight: 600 }}>{record.order.order_no}</span>
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
      width: 200,
      render: (_, record) => record.item?.product_name ?? '—',
    },
    {
      title: '商品规格',
      width: 160,
      render: (_, record) => record.item?.sku_name ?? '—',
    },
    {
      title: '单价',
      width: 100,
      render: (_, record) => yuan(record.item?.price_cents ?? 0),
    },
    {
      title: '数量',
      width: 80,
      render: (_, record) => record.item?.quantity ?? '—',
    },
    {
      title: '小计',
      width: 100,
      render: (_, record) => yuan(record.item?.subtotal_cents ?? 0),
    },
    {
      // 订单级金额：合并单元格不参与求和，避免重复累加
      title: '订单金额',
      width: 120,
      align: 'right',
      onCell: merge,
      render: (_, record) => yuan(record.order.payable_amount_cents),
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
      // 支付状态（钱）
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
      // 订单状态（货）
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
      title: '收货信息',
      width: 200,
      onCell: merge,
      render: (_, record) => {
        const address = record.order.receiver_address as
          | Record<string, string>
          | null
          | undefined;
        const area = address
          ? [address.province, address.city, address.district, address.detail]
              .filter(Boolean)
              .join(' ')
          : '';
        return (
          <div style={{ fontSize: 12, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 600 }}>
              {record.order.receiver_name ?? '—'}
            </div>
            <div>{record.order.receiver_phone ?? '—'}</div>
            <div style={{ color: 'var(--ant-color-text-secondary)' }}>
              {area || '—'}
            </div>
          </div>
        );
      },
    },
    {
      title: '物流单号',
      width: 180,
      onCell: merge,
      render: (_, record) => {
        const shipments = record.order.shipments ?? [];
        if (shipments.length === 0) return '—';
        return (
          <div style={{ fontSize: 12, lineHeight: 1.5 }}>
            {shipments.map((item) => (
              <div key={`${item.seller_order_id}-${item.tracking_no}`}>
                {item.carrier} {item.tracking_no}
              </div>
            ))}
          </div>
        );
      },
    },
    {
      title: '下单时间',
      width: 150,
      onCell: merge,
      render: (_, record) => formatDateTime(record.order.created_at),
    },
    {
      title: '备注',
      width: 160,
      onCell: merge,
      ellipsis: true,
      render: (_, record) => record.order.remark || '—',
    },
    {
      title: '操作',
      width: 200,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          {/* 真实支付：跳到支付页选「余额 / 微信 / 支付宝」，
              结果以渠道回调/对账为准，列表里不再有"点一下就成功" */}
          {record.first && record.order.payment_status === 'unpaid' ? (
            <Button
              size="small"
              type="primary"
              data-testid={`go-pay-${record.order.id}`}
              onClick={() =>
                navigate(`/portal/payment-result?orderId=${record.order.id}`)
              }
            >
              去支付
            </Button>
          ) : null}
          {record.first &&
          record.order.fulfillment_status === 'shipped' &&
          record.order.payment_status === 'paid' ? (
            <Button
              size="small"
              onClick={async () => {
                await confirmPortalOrder(record.order.id);
                message.success('已确认收货');
                refetch();
              }}
            >
              {record.item?.delivery_method === 'pickup'
                ? '确认已自提'
                : '确认收货'}
            </Button>
          ) : null}
          {record.first &&
          ['paid', 'refunding'].includes(record.order.payment_status) &&
          ['to_ship', 'shipped'].includes(record.order.fulfillment_status) ? (
            <Button
              size="small"
              danger
              disabled={record.order.payment_status === 'refunding'}
              onClick={async () => {
                const refund = await requestPortalRefund(
                  record.order.id,
                  '买家申请售后',
                );
                if (refund) {
                  message.success('售后申请已提交，等待卖家处理');
                  refetch();
                }
              }}
            >
              申请售后
            </Button>
          ) : null}
          {/* 完成后才有评价资格：一个订单项只能评一次，具体待评项在「我的评价」里列 */}
          {record.first && record.order.payment_status === 'refunding' ? (
            <Popconfirm
              title="取消售后申请？"
              description="卖家还没处理，取消后订单恢复为已支付"
              onConfirm={async () => {
                await cancelPortalRefund(record.order.id);
                message.success('已取消售后申请');
                refetch();
              }}
            >
              <Button
                size="small"
                data-testid={`cancel-refund-${record.order.id}`}
              >
                取消售后
              </Button>
            </Popconfirm>
          ) : null}
          {record.first && record.order.fulfillment_status === 'completed' ? (
            <Button
              size="small"
              type="link"
              onClick={() => navigate('/portal/reviews')}
            >
              去评价
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <PortalShell title="我的订单" wide>
      <Card>
        <Table<Row>
          rowKey="key"
          columns={columns}
          dataSource={rows}
          loading={isLoading}
          scroll={{ x: 2100 }}
          pagination={{ defaultPageSize: 20, showSizeChanger: true }}
          locale={{ emptyText: <Empty description="还没有订单" /> }}
        />
        <Typography.Paragraph
          type="secondary"
          style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}
        >
          商品、规格与金额已直接列在表中；需要物流与收货信息再点「详情」。
        </Typography.Paragraph>
      </Card>
    </PortalShell>
  );
}
