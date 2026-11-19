import {
  ArrowLeftOutlined,
  ShoppingOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from '@umijs/max';
import {
  Alert,
  App,
  Button,
  Card,
  Divider,
  Empty,
  Form,
  Image,
  Input,
  Radio,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useMemo, useState } from 'react';
import {
  checkoutCart,
  createOrderPayment,
  createPortalOrder,
  listAddresses,
  payWithWallet,
  previewCheckout,
  queryOrderPayment,
} from '@/services/commerce/api';
import { getWallet } from '@/services/wallet/api';
import PortalPlainShell from '../components/PortalPlainShell';

/**
 * 订单确认页（独立页面，不是弹窗）。
 *
 * 两条入口共用这一页：
 *   - 详情页「立即购买」→ /portal/checkout?skuId=..&quantity=..
 *   - 购物车「去结算」  → /portal/checkout?from=cart
 *
 * 设计要点：
 * 1. **点「提交订单并支付」才建单** —— 避免进页面就产生一堆未支付订单；
 * 2. 商品清单/金额来自服务端 `checkout/preview`，前端不自己拼（价格库存随时会变）；
 * 3. 三种支付方式在同一页：余额即时、微信就地出码轮询、支付宝整页跳收银台。
 */

const yuan = (cents?: number | null) =>
  typeof cents === 'number' ? `¥${(cents / 100).toFixed(2)}` : '—';

const DRAFT_KEY = 'checkout-draft-v1';

type PaymentMethod = 'wallet' | 'wechat' | 'alipay';

export default function CheckoutPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [form] = Form.useForm();

  const fromCart = params.get('from') === 'cart';
  const skuId = Number(params.get('skuId') ?? 0) || undefined;
  const quantity = Math.max(1, Number(params.get('quantity') ?? 1));

  const [payment, setPayment] = useState<PaymentMethod>('wallet');
  const [deliveryBySeller, setDeliveryBySeller] = useState<
    Record<number, 'express' | 'pickup'>
  >({});
  const [submitting, setSubmitting] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: ['checkout-preview', fromCart, skuId, quantity],
    queryFn: () =>
      previewCheckout({
        mode: fromCart ? 'cart' : 'buy',
        sku_id: fromCart ? undefined : skuId,
        quantity,
      }),
  });
  const addresses = useQuery({
    queryKey: ['portal-addresses'],
    queryFn: listAddresses,
  });
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: getWallet });

  // 新窗口建地址回来时刷新
  useEffect(() => {
    const onFocus = () => {
      addresses.refetch();
      preview.refetch();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [addresses, preview]);

  // 刷新不丢：地址/备注/交付方式/支付方式暂存
  useEffect(() => {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as {
        address_id?: number;
        remark?: string;
        delivery?: Record<number, 'express' | 'pickup'>;
        payment?: PaymentMethod;
      };
      if (draft.address_id)
        form.setFieldsValue({ address_id: draft.address_id });
      if (draft.remark) form.setFieldsValue({ remark: draft.remark });
      if (draft.delivery) setDeliveryBySeller(draft.delivery);
      if (draft.payment) setPayment(draft.payment);
    } catch {
      sessionStorage.removeItem(DRAFT_KEY);
    }
    // 只在首次挂载恢复（不能把 form/setter 放进依赖，否则会反复覆盖用户输入）
  }, []);

  const saveDraft = () => {
    const values = form.getFieldsValue();
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        address_id: values.address_id,
        remark: values.remark,
        delivery: deliveryBySeller,
        payment,
      }),
    );
  };

  const data = preview.data;
  const items = useMemo(() => data?.items ?? [], [data]);
  const sellers = useMemo(() => data?.sellers ?? [], [data]);
  const blocked = (data?.issues ?? []).length > 0 || items.length === 0;

  const balance = wallet.data?.available_cents ?? 0;
  const notEnough = balance < (data?.total_cents ?? 0);

  const pollPaid = async (orderId: number) => {
    for (let i = 0; i < 100; i += 1) {
      const result = await queryOrderPayment(orderId, 'wechat').catch(
        () => undefined,
      );
      if (result?.paid) return true;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    return false;
  };

  const submit = async () => {
    const values = await form.validateFields();
    const address = (addresses.data ?? []).find(
      (item) => item.id === values.address_id,
    );
    if (!address) {
      message.warning('请选择收货地址');
      return;
    }
    const delivery = sellers.map((group) => ({
      seller_id: group.seller_id,
      delivery_method: deliveryBySeller[group.seller_id] ?? 'express',
    }));

    setSubmitting(true);
    try {
      // ① 建单
      const order = fromCart
        ? await checkoutCart({
            address_id: address.id,
            receiver_name: address.receiver_name,
            receiver_phone: address.receiver_phone,
            receiver_address: {
              province: address.province,
              city: address.city,
              district: address.district,
              detail: address.detail,
            },
            remark: values.remark,
            delivery,
          })
        : await createPortalOrder({
            sku_id: skuId as number,
            quantity,
            address_id: address.id,
            receiver_name: address.receiver_name,
            receiver_phone: address.receiver_phone,
            receiver_address: {
              detail: `${address.province}${address.city}${address.district}${address.detail}`,
            },
            remark: values.remark,
            delivery,
          });

      // ② 支付
      if (payment === 'wallet') {
        await payWithWallet(order.id);
        sessionStorage.removeItem(DRAFT_KEY);
        message.success('支付成功');
        navigate(`/portal/payment-result?orderId=${order.id}`);
        return;
      }
      const result = await createOrderPayment(
        order.id,
        payment === 'wechat' ? 'wechat' : 'alipay',
      );
      if (result.type === 'redirect' && result.url) {
        sessionStorage.removeItem(DRAFT_KEY);
        window.location.href = result.url;
        return;
      }
      if (result.type === 'qrcode' && result.code_url) {
        setQr(result.code_url);
        message.info('请用微信扫码支付');
        const paid = await pollPaid(order.id);
        if (paid) {
          sessionStorage.removeItem(DRAFT_KEY);
          message.success('支付成功');
          navigate(`/portal/payment-result?orderId=${order.id}`);
        } else {
          message.warning('暂未收到支付成功，可在「我的订单」继续支付');
        }
        return;
      }
      message.error('渠道未返回可用的支付信息');
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (preview.isLoading) {
    return (
      <PortalPlainShell title="确认订单">
        <Spin style={{ display: 'block', margin: '80px auto' }} />
      </PortalPlainShell>
    );
  }

  return (
    <PortalPlainShell title="确认订单">
      <Space orientation="vertical" size={16} style={{ display: 'flex' }}>
        <Button
          type="link"
          icon={<ArrowLeftOutlined />}
          style={{ paddingLeft: 0 }}
          onClick={() => navigate(-1)}
        >
          返回
        </Button>

        {(data?.issues ?? []).map((issue) => (
          <Alert key={issue} type="error" showIcon title={issue} />
        ))}

        {items.length === 0 ? (
          <Card>
            <Empty description="没有要结算的商品">
              <Button type="primary" onClick={() => navigate('/portal/cart')}>
                去购物车
              </Button>
            </Empty>
          </Card>
        ) : null}

        {/* ① 商品清单 */}
        {items.length > 0 ? (
          <Card title="商品清单" size="small" data-testid="checkout-items">
            {sellers.map((group) => (
              <div key={group.seller_id} style={{ marginBottom: 16 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  <ShoppingOutlined /> {group.shop_name || group.seller_name}
                  {group.seller_username ? `（${group.seller_username}）` : ''}
                </Typography.Text>
                {items
                  .filter((item) => item.seller_id === group.seller_id)
                  .map((item) => (
                    <div
                      key={item.sku_id}
                      style={{
                        display: 'flex',
                        gap: 12,
                        padding: '10px 0',
                        borderBottom:
                          '1px solid var(--ant-color-border-secondary)',
                      }}
                    >
                      {item.image ? (
                        <Image
                          src={item.image}
                          alt={item.product_name}
                          width={64}
                          height={64}
                          style={{ objectFit: 'cover', borderRadius: 6 }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 64,
                            height: 64,
                            borderRadius: 6,
                            background: 'var(--ant-color-fill-secondary)',
                          }}
                        />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>
                          {item.product_name}
                        </div>
                        <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                          规格：{item.sku_name}
                        </div>
                        <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                          {yuan(item.price_cents)} × {item.quantity}
                        </div>
                      </div>
                      <div style={{ fontWeight: 600 }}>
                        {yuan(item.subtotal_cents)}
                      </div>
                    </div>
                  ))}
                <div style={{ marginTop: 10 }}>
                  <Space>
                    <Typography.Text style={{ fontSize: 12 }}>
                      交付方式
                    </Typography.Text>
                    <Radio.Group
                      size="small"
                      value={deliveryBySeller[group.seller_id] ?? 'express'}
                      onChange={(event) => {
                        setDeliveryBySeller((prev) => ({
                          ...prev,
                          [group.seller_id]: event.target.value,
                        }));
                        saveDraft();
                      }}
                    >
                      <Radio.Button value="express">物流快递</Radio.Button>
                      <Radio.Button
                        value="pickup"
                        disabled={
                          !group.delivery_methods.includes('pickup') ||
                          !group.pickup_address
                        }
                      >
                        自提
                      </Radio.Button>
                    </Radio.Group>
                  </Space>
                  {deliveryBySeller[group.seller_id] === 'pickup' ? (
                    <div
                      style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4 }}
                    >
                      自提门店：{group.pickup_address || '卖家未填写'}
                      {group.pickup_note ? ` · ${group.pickup_note}` : ''}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            <Divider style={{ margin: '12px 0' }} />
            <div style={{ textAlign: 'right' }}>
              <Typography.Text>
                合计：
                <Typography.Text
                  strong
                  style={{ fontSize: 18, color: '#cf1322' }}
                >
                  {yuan(data?.total_cents)}
                </Typography.Text>
              </Typography.Text>
            </div>
          </Card>
        ) : null}

        {/* ② 收货地址 + 备注 */}
        <Card title="收货信息" size="small">
          <Form form={form} layout="vertical">
            <Form.Item
              label="收货地址"
              name="address_id"
              rules={[{ required: true, message: '请选择收货地址' }]}
            >
              <Select
                placeholder="选择已保存的地址"
                options={(addresses.data ?? []).map((item) => ({
                  value: item.id,
                  label: `${item.is_default ? '[默认] ' : ''}${item.receiver_name} ${item.receiver_phone} ${item.province}${item.city}${item.district}${item.detail}`,
                }))}
                notFoundContent="还没有收货地址，点下方「管理收货地址」新增"
                onChange={() => saveDraft()}
              />
            </Form.Item>
            <Button
              type="link"
              style={{ paddingLeft: 0, marginBottom: 12 }}
              onClick={() =>
                window.open('/portal/addresses', '_blank', 'noopener')
              }
            >
              管理收货地址（新窗口）
            </Button>
            <Form.Item label="备注" name="remark">
              <Input.TextArea
                rows={2}
                placeholder="选填"
                onChange={() => saveDraft()}
              />
            </Form.Item>
          </Form>
        </Card>

        {/* ③ 支付方式 + 提交 */}
        <Card title="支付方式" size="small">
          <Radio.Group
            value={payment}
            onChange={(event) => {
              setPayment(event.target.value);
              saveDraft();
            }}
            style={{ width: '100%' }}
          >
            <Space orientation="vertical" style={{ display: 'flex' }}>
              <Radio value="wallet" disabled={notEnough}>
                <WalletOutlined /> 余额支付
                <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                  可用 {yuan(balance)}
                  {notEnough ? '（余额不足）' : ''}
                </Typography.Text>
              </Radio>
              <Radio value="wechat">微信支付（扫码）</Radio>
              <Radio value="alipay">支付宝（跳转收银台）</Radio>
            </Space>
          </Radio.Group>

          {qr ? (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <QRCodeSVG value={qr} size={180} />
              <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 8 }}>
                微信扫码支付；支付完成后本页会自动跳转
              </div>
            </div>
          ) : null}

          <Divider style={{ margin: '12px 0' }} />
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              合计 {yuan(data?.total_cents)}
            </Typography.Text>
            <Button
              type="primary"
              size="large"
              loading={submitting}
              disabled={blocked}
              data-testid="checkout-submit"
              onClick={submit}
            >
              提交订单并支付
            </Button>
          </Space>
          <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 8 }}>
            <Tag>提示</Tag>
            点击后才会创建订单；未完成支付可在「我的订单」继续支付。
            {data?.unpaid_close_days ? (
              <span style={{ marginLeft: 4 }}>
                下单后 {data.unpaid_close_days} 天内未支付将自动关闭。
              </span>
            ) : null}
          </div>
        </Card>
      </Space>
    </PortalPlainShell>
  );
}
