import { ShopOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Link, useModel } from '@umijs/max';
import {
  Button,
  Card,
  Col,
  Empty,
  Row,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { listMyFavorites, listPortalOrders } from '@/services/commerce/api';
import type { PortalOrder } from '@/services/commerce/types';
import {
  FULFILLMENT_STATUS,
  FULFILLMENT_STATUS_COLOR,
  labelOf,
  PAYMENT_STATUS,
  PAYMENT_STATUS_COLOR,
} from '@/utils/labels';
import PortalShell from './components/PortalShell';

/**
 * 买家中心 · 概览。
 *
 * 侧栏已经能把人带到每个页面，所以这里**不再放 6 张重复的入口卡**，
 * 只给「一眼看清账号状态」的三样东西：数字块、最近订单、待评价提醒。
 */
export default function PortalCenterPage() {
  const { initialState } = useModel('@@initialState');
  const orders = useQuery({
    queryKey: ['portal-orders'],
    queryFn: listPortalOrders,
  });
  const favorites = useQuery({
    queryKey: ['my-favorites'],
    queryFn: listMyFavorites,
  });

  const list = orders.data ?? [];
  const toPay = list.filter((item) => item.payment_status === 'unpaid').length;
  const toReview = list.filter(
    (item) => item.fulfillment_status === 'completed',
  ).length;

  const columns: ColumnsType<PortalOrder> = [
    { title: '订单号', dataIndex: 'order_no' },
    {
      // 支付状态（钱）与订单状态（货）分开显示：概览页也不该混成一个"状态"
      title: '支付状态',
      width: 100,
      render: (_, record) => (
        <Tag color={PAYMENT_STATUS_COLOR[record.payment_status] ?? 'default'}>
          {labelOf(PAYMENT_STATUS, record.payment_status)}
        </Tag>
      ),
    },
    {
      title: '订单状态',
      width: 100,
      render: (_, record) => (
        <Tag
          color={
            FULFILLMENT_STATUS_COLOR[record.fulfillment_status] ?? 'default'
          }
        >
          {labelOf(FULFILLMENT_STATUS, record.fulfillment_status)}
        </Tag>
      ),
    },
    {
      title: '金额',
      dataIndex: 'payable_amount_cents',
      width: 110,
      render: (v: number) => `¥${((v ?? 0) / 100).toFixed(2)}`,
    },
  ];

  return (
    <PortalShell title="概览">
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        你好，{initialState?.currentUser?.name || '买家'}
      </Typography.Title>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="订单总数"
              value={list.length}
              suffix={<Link to="/portal/orders">查看</Link>}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="待付款"
              value={toPay}
              suffix={<Link to="/portal/orders">去支付</Link>}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="待评价"
              value={toReview}
              suffix={<Link to="/portal/reviews">去评价</Link>}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="我的收藏"
              value={favorites.data?.length ?? 0}
              suffix={<Link to="/portal/favorites">查看</Link>}
            />
          </Card>
        </Col>
      </Row>

      {/* 卖家中心入口：侧栏底部也有，但概览页给一个更显眼的位置（新用户不一定会看底部） */}
      <Card
        size="small"
        style={{ marginBottom: 16 }}
        data-testid="portal-seller-entry"
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <Typography.Text strong>
              <ShopOutlined /> 卖家中心
            </Typography.Text>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                管理店铺、商品、订单与结算
              </Typography.Text>
            </div>
          </div>
          <Button
            type="primary"
            href="/portal/seller"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="portal-go-seller"
          >
            进入卖家中心
          </Button>
        </div>
      </Card>

      <Card title="最近订单">
        {list.length === 0 && !orders.isLoading ? (
          <Empty description="还没有订单">
            <Link to="/products">去逛逛</Link>
          </Empty>
        ) : (
          <Table
            rowKey="id"
            size="small"
            loading={orders.isLoading}
            columns={columns}
            dataSource={list.slice(0, 5)}
            pagination={false}
          />
        )}
      </Card>
    </PortalShell>
  );
}
