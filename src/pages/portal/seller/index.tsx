import { ShopOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@umijs/max';
import {
  App,
  Button,
  Card,
  Col,
  Row,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  getSellerProfile,
  listSellerOrders,
  listSellerProducts,
  requestSellerPayout,
} from '@/services/commerce/api';
import type { SellerOrderRecord } from '@/services/commerce/types';
import SellerShell from './components/SellerShell';

/**
 * 卖家中心 · 店铺概览。
 *
 * 侧栏已经能到各子页面，所以这里不再重复堆入口，只给「一眼看清店铺状态」的信息：
 * 店铺信息、商品/订单/收藏/评价四个数、以及最近订单。
 */
export default function SellerOverviewPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const profile = useQuery({
    queryKey: ['seller-profile'],
    queryFn: getSellerProfile,
  });
  const products = useQuery({
    queryKey: ['seller-products'],
    queryFn: listSellerProducts,
  });
  const orders = useQuery({
    queryKey: ['seller-orders'],
    queryFn: listSellerOrders,
  });

  const handlePayout = async () => {
    try {
      const payout = await requestSellerPayout();
      message.success(`结算成功：¥${(payout.amount_cents / 100).toFixed(2)}`);
      queryClient.invalidateQueries({ queryKey: ['seller-profile'] });
      queryClient.invalidateQueries({ queryKey: ['seller-orders'] });
    } catch (error) {
      message.error((error as Error)?.message || '结算失败');
    }
  };

  const productList = products.data ?? [];
  const orderList = orders.data ?? [];
  const pendingShip = orderList.filter((item) =>
    ['paid', 'processing'].includes(item.status),
  );

  const columns: ColumnsType<SellerOrderRecord> = [
    { title: '卖家单号', dataIndex: 'seller_order_no' },
    {
      title: '状态',
      dataIndex: 'status',
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: '应结算',
      dataIndex: 'payable_to_seller_cents',
      render: (v: number) => `¥${(v / 100).toFixed(2)}`,
    },
  ];

  return (
    <SellerShell title="店铺概览">
      <Card style={{ marginBottom: 16 }} data-testid="seller-profile">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              <ShopOutlined /> {profile.data?.display_name || '卖家'}
            </Typography.Title>
            <Typography.Text type="secondary">
              店铺：{profile.data?.shop?.name || '-'} · KYC：
              {profile.data?.kyc_status || '-'} · 状态：
              {profile.data?.status || '-'}
            </Typography.Text>
          </div>
          <Button onClick={handlePayout}>申请结算</Button>
        </div>
      </Card>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="我的商品"
              value={productList.length}
              suffix={<Link to="/portal/seller/products">查看</Link>}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="待发货"
              value={pendingShip.length}
              suffix={<Link to="/portal/seller/orders">处理</Link>}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="收藏合计"
              value={productList.reduce(
                (sum, item) => sum + (item.favorite_count ?? 0),
                0,
              )}
              suffix={<Link to="/portal/seller/favorites">查看</Link>}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="评价合计"
              value={productList.reduce(
                (sum, item) => sum + (item.review_count ?? 0),
                0,
              )}
              suffix={<Link to="/portal/seller/reviews">查看</Link>}
            />
          </Card>
        </Col>
      </Row>

      <Card title="最近订单">
        <Table
          rowKey="id"
          size="small"
          loading={orders.isLoading}
          columns={columns}
          dataSource={orderList.slice(0, 5)}
          pagination={false}
        />
      </Card>
    </SellerShell>
  );
}
