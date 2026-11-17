import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@umijs/max';
import {
  App,
  Button,
  Card,
  Empty,
  Image,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  confirmPortalOrder,
  listPortalOrders,
  mockPayPortalOrder,
} from '@/services/commerce/api';
import type { OrderItemRecord, PortalOrder } from '@/services/commerce/types';
import {
  labelOf,
  ORDER_STATUS,
  PRODUCT_TYPE,
  PRODUCT_TYPE_COLOR,
} from '@/utils/labels';
import PortalShell from '../components/PortalShell';

const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

const STATUS_COLOR: Record<string, string> = {
  pending_payment: 'orange',
  paid: 'blue',
  shipped: 'geekblue',
  completed: 'green',
  cancelled: 'default',
  refunded: 'red',
};

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
        <a onClick={() => navigate(`/portal/orders/${record.order.id}`)}>
          {record.order.order_no}
        </a>
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
      title: '状态',
      width: 120,
      onCell: merge,
      render: (_, record) => (
        <Tag color={STATUS_COLOR[record.order.status] ?? 'default'}>
          {labelOf(ORDER_STATUS, record.order.status)}
        </Tag>
      ),
    },
    {
      title: '操作',
      width: 220,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          {record.first ? (
            <Button
              size="small"
              onClick={() => navigate(`/portal/orders/${record.order.id}`)}
            >
              详情
            </Button>
          ) : null}
          {record.first && record.order.status === 'pending_payment' ? (
            <Button
              size="small"
              type="primary"
              onClick={async () => {
                await mockPayPortalOrder(record.order.id);
                message.success('支付成功');
                refetch();
              }}
            >
              模拟支付
            </Button>
          ) : null}
          {record.first && record.order.status === 'shipped' ? (
            <Button
              size="small"
              onClick={async () => {
                await confirmPortalOrder(record.order.id);
                message.success('已确认收货');
                refetch();
              }}
            >
              确认收货
            </Button>
          ) : null}
          {/* 完成后才有评价资格：一个订单项只能评一次，具体待评项在「我的评价」里列 */}
          {record.first && record.order.status === 'completed' ? (
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
    <PortalShell title="我的订单">
      <Card>
        <Table<Row>
          rowKey="key"
          columns={columns}
          dataSource={rows}
          loading={isLoading}
          scroll={{ x: 1500 }}
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
