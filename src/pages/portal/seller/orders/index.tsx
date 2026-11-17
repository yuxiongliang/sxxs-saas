import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Form, Image, Input, Modal, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMemo, useState } from 'react';
import { listSellerOrders, shipMySellerOrder } from '@/services/commerce/api';
import type {
  OrderItemRecord,
  SellerOrderRecord,
} from '@/services/commerce/types';
import {
  labelOf,
  ORDER_STATUS,
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
      title: '状态',
      width: 110,
      onCell: merge,
      render: (_, record) => (
        <Tag>{labelOf(ORDER_STATUS, record.order.status)}</Tag>
      ),
    },
    {
      title: '操作',
      width: 110,
      fixed: 'right',
      render: (_, record) =>
        ['paid', 'processing'].includes(record.order.status) ? (
          <Button
            type="link"
            size="small"
            onClick={() => {
              setSelectedOrder(record.order);
              setShipOpen(true);
            }}
          >
            发货
          </Button>
        ) : null,
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
