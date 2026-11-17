import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Form, Input, Modal, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { listSellerOrders, shipMySellerOrder } from '@/services/commerce/api';
import type { SellerOrderRecord } from '@/services/commerce/types';
import SellerShell from '../components/SellerShell';

/** 我的订单（卖家侧）：查看子订单并处理发货。 */
export default function SellerOrdersPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [shipOpen, setShipOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<SellerOrderRecord>();
  const [shipForm] = Form.useForm();

  const orders = useQuery({
    queryKey: ['seller-orders'],
    queryFn: listSellerOrders,
  });

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

  const columns: ColumnsType<SellerOrderRecord> = [
    { title: '卖家单号', dataIndex: 'seller_order_no' },
    {
      title: '状态',
      dataIndex: 'status',
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: '商品金额',
      dataIndex: 'goods_amount_cents',
      render: (v: number) => `¥${(v / 100).toFixed(2)}`,
    },
    {
      title: '佣金',
      dataIndex: 'commission_amount_cents',
      render: (v: number) => `¥${(v / 100).toFixed(2)}`,
    },
    {
      title: '应结算',
      dataIndex: 'payable_to_seller_cents',
      render: (v: number) => `¥${(v / 100).toFixed(2)}`,
    },
    {
      title: '操作',
      width: 120,
      render: (_, record) =>
        ['paid', 'processing'].includes(record.status) ? (
          <Button
            type="link"
            size="small"
            onClick={() => {
              setSelectedOrder(record);
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
        <Table
          rowKey="id"
          loading={orders.isLoading}
          columns={columns}
          dataSource={orders.data ?? []}
          pagination={false}
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
