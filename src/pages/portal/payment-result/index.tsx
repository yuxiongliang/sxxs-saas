import {
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from '@umijs/max';
import {
  App,
  Button,
  Card,
  Descriptions,
  Result,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { QRCodeSVG } from 'qrcode.react';
import React, { useState } from 'react';
import {
  createOrderPayment,
  listPortalOrders,
  mockPayPortalOrder,
  queryOrderPayment,
} from '@/services/commerce/api';
import { FULFILLMENT_STATUS, labelOf, PAYMENT_STATUS } from '@/utils/labels';
import PortalPlainShell from '../components/PortalPlainShell';

const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

const statusMeta = (status: string) => {
  switch (status) {
    case 'paid':
      return {
        status: 'success' as const,
        title: '支付成功',
        icon: <CheckCircleFilled />,
      };
    case 'pending_payment':
      return {
        status: 'warning' as const,
        title: '待支付',
        icon: <ClockCircleOutlined />,
      };
    case 'cancelled':
      return {
        status: 'error' as const,
        title: '订单已取消',
        icon: <CloseCircleFilled />,
      };
    case 'completed':
      return {
        status: 'success' as const,
        title: '交易完成',
        icon: <CheckCircleFilled />,
      };
    default:
      return {
        status: 'info' as const,
        title: status,
        icon: <ClockCircleOutlined />,
      };
  }
};

const PaymentResultPage: React.FC = () => {
  const [params] = useSearchParams();
  const orderId = Number(params.get('orderId'));
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [paying, setPaying] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['portal-orders'],
    queryFn: listPortalOrders,
  });

  const order = data?.find((item) => item.id === orderId);
  // 支付结果页只关心钱这一维：已支付即成功，其余按未支付处理
  const meta = statusMeta(
    order?.payment_status === 'paid' ? 'paid' : 'pending_payment',
  );

  // 微信扫码：code_url 渲染二维码，前端每 3 秒主动查一次（回调丢了也能自动收敛）
  const [qr, setQr] = useState<{ codeUrl: string; provider: 'wechat' } | null>(
    null,
  );

  const pollUntilPaid = async (provider: 'wechat' | 'alipay') => {
    for (let i = 0; i < 100; i += 1) {
      const result = await queryOrderPayment(orderId, provider).catch(
        () => undefined,
      );
      if (result?.paid) {
        message.success('支付成功');
        await refetch();
        setQr(null);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  };

  const pay = async (method: 'wallet' | 'wechat' | 'alipay') => {
    if (!order) return;
    setPaying(true);
    try {
      if (method === 'wallet') {
        await mockPayPortalOrder(order.id, 'wallet');
        message.success('支付成功');
        await refetch();
        return;
      }
      // 微信/支付宝：**真实下单**，支付结果只认渠道回调/主动查询
      const result = await createOrderPayment(order.id, method);
      if (result.type === 'already_paid') {
        await refetch();
        return;
      }
      if (result.type === 'redirect' && result.url) {
        // 支付宝电脑网站支付：整页跳到渠道收银台
        window.location.href = result.url;
        return;
      }
      if (result.type === 'qrcode' && result.code_url) {
        setQr({ codeUrl: result.code_url, provider: 'wechat' });
        message.info('请用微信扫码支付，支付完成后页面会自动刷新');
        await pollUntilPaid('wechat');
        return;
      }
      message.error('渠道未返回可用的支付信息');
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setPaying(false);
    }
  };

  return (
    <PortalPlainShell title="支付结果">
      <Spin spinning={isLoading}>
        <Card>
          {!order && !isLoading ? (
            <Result
              status="404"
              title="订单不存在"
              subTitle="请确认订单号，或回到商城重新下单"
              extra={
                <Button type="primary" onClick={() => navigate('/portal')}>
                  返回商城
                </Button>
              }
            />
          ) : (
            <>
              <Result
                status={meta.status}
                icon={meta.icon}
                title={meta.title}
                subTitle={order ? `订单号 ${order.order_no}` : '正在加载订单…'}
                extra={
                  <Space orientation="vertical" style={{ width: '100%' }}>
                    {order?.payment_status === 'unpaid' ? (
                      <>
                        {/* 三种支付方式：余额即时扣款；微信/支付宝本期是**模拟渠道**，
                            流程与真实一致，以后换成真实支付只改后端一层 */}
                        <Space>
                          <Button
                            type="primary"
                            loading={paying}
                            data-testid="pay-wallet"
                            onClick={() => pay('wallet')}
                          >
                            余额支付
                          </Button>
                          <Button
                            loading={paying}
                            data-testid="pay-wechat"
                            onClick={() => pay('wechat')}
                          >
                            微信支付
                          </Button>
                          <Button
                            loading={paying}
                            data-testid="pay-alipay"
                            onClick={() => pay('alipay')}
                          >
                            支付宝
                          </Button>
                        </Space>
                        <div style={{ marginTop: 8 }}>
                          <Typography.Text
                            type="secondary"
                            style={{ fontSize: 12 }}
                          >
                            余额支付会即时扣减钱包余额；微信/支付宝为模拟渠道，点击即视为支付成功。
                          </Typography.Text>
                        </div>
                      </>
                    ) : null}
                    {order?.payment_status === 'unpaid' ? (
                      <Button
                        data-testid="pay-refresh"
                        onClick={async () => {
                          setPaying(true);
                          try {
                            const result = await queryOrderPayment(
                              order.id,
                              'alipay',
                            );
                            if (result.paid) {
                              message.success('已确认支付成功');
                              await refetch();
                            } else {
                              message.info('渠道还没返回成功，请稍后再试');
                            }
                          } catch (error) {
                            message.error((error as Error).message);
                          } finally {
                            setPaying(false);
                          }
                        }}
                      >
                        刷新支付状态
                      </Button>
                    ) : null}
                    <Button onClick={() => navigate('/portal')}>
                      继续购物
                    </Button>
                    {qr ? (
                      <div style={{ marginTop: 16, textAlign: 'center' }}>
                        <QRCodeSVG value={qr.codeUrl} size={180} />
                        <div style={{ marginTop: 8 }}>
                          <Typography.Text type="secondary">
                            微信扫码支付（关闭本页后仍可在「我的订单」继续支付）
                          </Typography.Text>
                        </div>
                      </div>
                    ) : null}
                  </Space>
                }
              />
              {order ? (
                <Descriptions
                  column={1}
                  bordered
                  size="small"
                  style={{ marginTop: 16 }}
                >
                  <Descriptions.Item label="订单号">
                    {order.order_no}
                  </Descriptions.Item>
                  <Descriptions.Item label="支付状态">
                    <Tag
                      color={order.payment_status === 'paid' ? 'green' : 'gold'}
                    >
                      {labelOf(PAYMENT_STATUS, order.payment_status)}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="订单状态">
                    <Tag>
                      {labelOf(FULFILLMENT_STATUS, order.fulfillment_status)}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="应付金额">
                    <Typography.Text
                      strong
                      style={{ color: '#ff4d4f', fontSize: 18 }}
                    >
                      {yuan(order.payable_amount_cents)}
                    </Typography.Text>
                  </Descriptions.Item>
                  {order.created_at ? (
                    <Descriptions.Item label="下单时间">
                      {order.created_at}
                    </Descriptions.Item>
                  ) : null}
                </Descriptions>
              ) : null}
            </>
          )}
        </Card>
      </Spin>
    </PortalPlainShell>
  );
};

export default PaymentResultPage;
