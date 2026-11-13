import {
  ArrowRightOutlined,
  AuditOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  ThunderboltOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Link, useModel } from '@umijs/max';
import { Button, Card, Col, Row, Space, Tag, Typography, theme } from 'antd';
import { getDashboardOverview } from '@/services/dashboard/api';

const { Title, Paragraph, Text } = Typography;

function StatBlock(props: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {props.label}
      </Text>
      <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.4 }}>
        {props.value}
      </div>
      {props.hint ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {props.hint}
        </Text>
      ) : null}
    </div>
  );
}

export default function WelcomePage() {
  const { initialState } = useModel('@@initialState');
  // 卡片底色跟着主题走：原来写死的浅蓝渐变在暗色模式下是一块刺眼的白斑。
  const { token } = theme.useToken();
  const { data: overview } = useQuery({
    queryKey: ['welcome-overview'],
    queryFn: () => getDashboardOverview(7),
    retry: false,
  });

  const user = initialState?.currentUser;
  const username = initialState?.username ?? user?.name ?? '未登录';
  const usage = overview?.usage;

  return (
    <div>
      <Card
        styles={{ body: { padding: 32 } }}
        style={{
          marginBottom: 16,
          border: 'none',
          background: `linear-gradient(120deg, ${token.colorPrimaryBg} 0%, ${token.colorBgContainer} 55%, ${token.colorBgContainer} 100%)`,
        }}
      >
        <Space orientation="vertical" size={4}>
          <Tag color="blue">{username}</Tag>
          <Title level={2} style={{ margin: '8px 0 0' }}>
            {`欢迎回来，${user?.name ?? '管理员'}`}
          </Title>
          <Paragraph
            type="secondary"
            style={{ marginBottom: 8, maxWidth: 720 }}
          >
            这是 C2C 多卖家商城的管理后台：租户与权限、卖家与商品、交易履约、IM
            客服、佣金结算、SaaS 计费与审计，全部在这里。
          </Paragraph>
        </Space>
        <Space wrap>
          <Button type="primary" href="/dashboard/analysis">
            进入经营看板
            <ArrowRightOutlined />
          </Button>
          <Button href="/" target="_blank">
            去往首页
          </Button>
          <Button href="/dashboard/workplace">我的工作台</Button>
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="套餐详情" size="small">
            <Row gutter={[8, 16]}>
              <Col span={12}>
                <StatBlock
                  label="套餐"
                  value={usage?.plan_name ?? usage?.plan ?? '—'}
                  hint={
                    usage?.subscription_status
                      ? `状态 ${usage.subscription_status}`
                      : undefined
                  }
                />
              </Col>
              <Col span={12}>
                <StatBlock
                  label="订阅剩余"
                  value={
                    usage?.days_left === null || usage?.days_left === undefined
                      ? '—'
                      : `${usage.days_left} 天`
                  }
                />
              </Col>
            </Row>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title="快捷操作" size="small">
            <Space orientation="vertical" style={{ width: '100%' }} size={10}>
              <Link to="/orders">
                <ShoppingCartOutlined /> {'订单管理'}
              </Link>
              <Link to="/commerce/products">
                <ShopOutlined /> {'商品管理'}
              </Link>
              <Link to="/finance">
                <WalletOutlined /> {'财务结算'}
              </Link>
              <Link to="/system/audit">
                <AuditOutlined /> {'审计日志'}
              </Link>
              <Link to="/docs" target="_blank">
                <ThunderboltOutlined /> {'接口文档 /docs'}
              </Link>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
