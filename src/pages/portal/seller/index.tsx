import { ShopOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@umijs/max';
import {
  App,
  Button,
  Card,
  Col,
  Form,
  Input,
  Row,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import {
  getSellerLedger,
  getSellerProfile,
  listSellerOrders,
  listSellerProducts,
  requestSellerPayout,
  updateSellerShop,
} from '@/services/commerce/api';
import type { SellerOrderRecord } from '@/services/commerce/types';
import { getWallet } from '@/services/wallet/api';
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

  const [shopForm] = Form.useForm<{ address?: string; pickup_note?: string }>();
  const [savingShop, setSavingShop] = useState(false);

  const profile = useQuery({
    queryKey: ['seller-profile'],
    queryFn: getSellerProfile,
  });
  // 商品支持自提时，买家结算会看到这里的地址与说明 —— 不填等于"凭空自提"
  const handleSaveShop = async () => {
    const values = await shopForm.validateFields();
    setSavingShop(true);
    try {
      await updateSellerShop({
        address: values.address ?? '',
        pickup_note: values.pickup_note ?? '',
      });
      message.success('自提点信息已保存');
      queryClient.invalidateQueries({ queryKey: ['seller-profile'] });
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSavingShop(false);
    }
  };

  useEffect(() => {
    if (!profile.data?.shop) return;
    shopForm.setFieldsValue({
      address: profile.data.shop.address ?? '',
      pickup_note: profile.data.shop.pickup_note ?? '',
    });
  }, [profile.data, shopForm]);

  const wallet = useQuery({ queryKey: ['wallet'], queryFn: getWallet });
  // 待结算货款来自卖家台账（还没到账期的钱），与钱包余额是两个口径
  const ledger = useQuery({
    queryKey: ['seller-ledger', profile.data?.id],
    queryFn: () => getSellerLedger(profile.data?.id as number),
    enabled: Boolean(profile.data?.id),
  });

  const products = useQuery({
    queryKey: ['seller-products'],
    queryFn: () => listSellerProducts(),
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
  const pendingShip = orderList.filter(
    (item) => item.fulfillment_status === 'to_ship',
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

      {/* 自提点：选「自提」的商品结算时，买家要看到去哪儿取、什么时间取 */}
      <Card
        size="small"
        title="自提点设置"
        style={{ marginBottom: 16 }}
        data-testid="seller-pickup-card"
      >
        <Form
          form={shopForm}
          layout="inline"
          initialValues={{
            address: profile.data?.shop?.address ?? '',
            pickup_note: profile.data?.shop?.pickup_note ?? '',
          }}
        >
          <Form.Item label="自提地址" name="address" style={{ minWidth: 320 }}>
            <Input placeholder="如：深圳市南山区科技园 1 号 A 座 101" />
          </Form.Item>
          <Form.Item
            label="自提说明"
            name="pickup_note"
            style={{ minWidth: 320 }}
          >
            <Input placeholder="如：工作日 10:00-18:00，请出示订单号" />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              loading={savingShop}
              onClick={handleSaveShop}
            >
              保存
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {/* 两个口径必须并排说清：钱包里是**已结算**的钱，待结算是还没到账期的钱 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card data-testid="seller-wallet-balance">
            <Statistic
              title="钱包余额（已结算）"
              value={`¥${((wallet.data?.balance_cents ?? 0) / 100).toFixed(2)}`}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              账期到期后货款自动转入，可在此提现
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="待结算货款"
              value={`¥${((ledger.data?.pending_cents ?? 0) / 100).toFixed(2)}`}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              未完成的订单 + 还在账期内的货款，到期后自动进钱包
            </Typography.Text>
          </Card>
        </Col>
      </Row>

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
