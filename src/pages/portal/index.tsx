import { useQuery } from '@tanstack/react-query';
import { Link, useModel } from '@umijs/max';
import { Card, Col, Empty, Row, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { listMyFavorites, listPortalOrders } from '@/services/commerce/api';
import type { PortalOrder } from '@/services/commerce/types';
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
  const toPay = list.filter((item) => item.status === 'pending_payment').length;
  const toReview = list.filter((item) => item.status === 'completed').length;

  const columns: ColumnsType<PortalOrder> = [
    { title: '订单号', dataIndex: 'order_no' },
    {
      title: '状态',
      dataIndex: 'status',
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: '金额',
      dataIndex: 'total_amount_cents',
      render: (v: number) => `¥${(v / 100).toFixed(2)}`,
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
