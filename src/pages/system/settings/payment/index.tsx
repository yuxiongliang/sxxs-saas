import {
  AlipayCircleOutlined,
  CheckCircleOutlined,
  ExperimentOutlined,
  QrcodeOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  WechatOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Modal,
  QRCode,
  Row,
  Segmented,
  Space,
  Switch,
  Tabs,
  Tag,
} from 'antd';
import React, { useEffect, useState } from 'react';
import InheritSwitch, {
  type SettingSource,
} from '@/pages/system/components/InheritSwitch';
import {
  getPaymentHealth,
  getSetting,
  saveSetting,
  testSetting,
} from '@/services/system/api';
import type { SettingTestResult } from '@/services/system/types';
import SettingPage from '../../components/SettingPage';
import TestResultAlert from '../../components/TestResultAlert';

const PaymentSettings: React.FC = () => {
  const [form] = Form.useForm();
  const health = useQuery({
    queryKey: ['payment-health'],
    queryFn: getPaymentHealth,
  });
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<SettingTestResult>();
  const [qrOpen, setQrOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['system-setting', 'payment'],
    queryFn: () => getSetting('payment'),
  });

  useEffect(() => {
    if (data) {
      form.setFieldsValue({
        enabled: data.enabled,
        alipay: data.config.alipay,
        wechat: data.config.wechat,
      });
    }
  }, [data, form]);

  const buildPayload = async () => {
    const values = await form.validateFields();
    return {
      enabled: values.enabled,
      config: { alipay: values.alipay, wechat: values.wechat },
    };
  };

  // 来源：本地覆盖优先级高于后端返回（点击后立刻响应，失败则回退）
  const [sourceOverride, setSourceOverride] = useState<SettingSource>();
  const source: SettingSource =
    sourceOverride ?? (data?.source === 'override' ? 'override' : 'inherit');
  const inheriting = source === 'inherit';

  const handleSourceChange = async (next: SettingSource) => {
    setSourceOverride(next);
    try {
      // 不传 config：只切换来源，保留自己已保存的配置
      await saveSetting('payment', { source: next, enabled: true });
      await queryClient.invalidateQueries({
        queryKey: ['system-setting', 'payment'],
      });
      message.success(
        next === 'inherit' ? '已切换为跟随系统' : '已切换为自定义',
      );
    } catch (error: any) {
      setSourceOverride(undefined);
      message.error(error?.message || '切换失败');
    }
  };

  const handleSave = async () => {
    if (inheriting) {
      message.info('当前跟随系统，无需保存；如需自定义请先切换到「自定义」');
      return;
    }
    try {
      setSaving(true);
      const payload = await buildPayload();
      await saveSetting('payment', { ...payload, source });
      message.success('支付设置已保存');
      await queryClient.invalidateQueries({
        queryKey: ['system-setting', 'payment'],
      });
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    try {
      setTesting(true);
      const payload = await buildPayload();
      const response = await testSetting('payment', payload.config);
      setResult(response);
      if (response.success) message.success('支付参数校验通过');
      else message.warning(response.message);
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error?.message || '测试失败');
    } finally {
      setTesting(false);
    }
  };

  return (
    <SettingPage
      title="支付设置"
      subTitle="接入支付宝与微信支付官方组件"
      icon={<SafetyCertificateOutlined />}
      extra={
        <Space>
          <Button
            icon={<ExperimentOutlined />}
            loading={testing}
            onClick={handleTest}
          >
            测试连接
          </Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={handleSave}
          >
            保存设置
          </Button>
        </Space>
      }
    >
      <TestResultAlert result={result} />
      <Alert
        showIcon
        type="info"
        title="真实支付已接入"
        description="支付宝走「电脑网站支付」，微信走 Native 扫码；支付结果只认渠道异步通知/主动查询。保存后请先看右侧「支付诊断」确认密钥与回调地址无误。"
        style={{ marginBottom: 16 }}
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card
            loading={isLoading}
            title="支付渠道配置"
            extra={<Tag color="blue">官方组件接入</Tag>}
          >
            <InheritSwitch
              source={source}
              effectiveSource={data?.effective_source}
              inheritAllowed={data?.inherit_allowed ?? true}
              platformActive={data?.platform_active ?? false}
              policyLocked={data?.policy_locked ?? false}
              maskedFields={data?.masked_fields}
              onChange={handleSourceChange}
            />
            <Form
              disabled={inheriting}
              form={form}
              layout="vertical"
              initialValues={{ enabled: true }}
            >
              <Form.Item
                label="启用支付模块"
                name="enabled"
                valuePropName="checked"
              >
                <Switch checkedChildren="启用" unCheckedChildren="停用" />
              </Form.Item>
              <Tabs
                items={[
                  {
                    key: 'alipay',
                    forceRender: true,
                    label: (
                      <Space>
                        <AlipayCircleOutlined style={{ color: '#1677ff' }} />
                        支付宝
                      </Space>
                    ),
                    children: (
                      <>
                        <Form.Item
                          label="启用支付宝"
                          name={['alipay', 'enabled']}
                          valuePropName="checked"
                        >
                          <Switch />
                        </Form.Item>
                        <Form.Item
                          label="运行环境"
                          name={['alipay', 'environment']}
                        >
                          <Segmented
                            options={[
                              { label: '沙箱环境', value: 'sandbox' },
                              { label: '生产环境', value: 'production' },
                            ]}
                          />
                        </Form.Item>
                        <Row gutter={16}>
                          <Col span={12}>
                            <Form.Item
                              label="App ID"
                              name={['alipay', 'appId']}
                              rules={[
                                {
                                  required: true,
                                  message: '请输入支付宝 App ID',
                                },
                              ]}
                            >
                              <Input placeholder="2021000000000000" />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item
                              label="商户号"
                              name={['alipay', 'merchantId']}
                            >
                              <Input placeholder="2088000000000000" />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Form.Item
                          label="应用私钥"
                          name={['alipay', 'privateKey']}
                          extra="仅保存在后端，前端不会持久化明文；生产环境请使用 KMS/Vault。"
                        >
                          <Input.TextArea
                            rows={3}
                            placeholder="-----BEGIN PRIVATE KEY-----"
                          />
                        </Form.Item>
                        <Form.Item
                          label="支付宝公钥"
                          name={['alipay', 'publicKey']}
                        >
                          <Input.TextArea
                            rows={3}
                            placeholder="-----BEGIN PUBLIC KEY-----"
                          />
                        </Form.Item>
                        <Row gutter={16}>
                          <Col span={12}>
                            <Form.Item
                              label="异步通知地址"
                              name={['alipay', 'notifyUrl']}
                              extra="必须是公网可达的本系统回调：/api/v1/public/payments/alipay/notify"
                            >
                              <Input placeholder="https://your-domain.com/api/v1/public/payments/alipay/notify" />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item
                              label="同步返回地址"
                              name={['alipay', 'returnUrl']}
                              extra="用户付完跳回的前台页面"
                            >
                              <Input placeholder="https://your-domain.com/portal/payment-result" />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Row gutter={16}>
                          <Col span={12}>
                            <Form.Item
                              label="应用公钥证书 SN（证书模式）"
                              name={['alipay', 'appCertSn']}
                              extra="应用是证书模式才填；与根证书 SN 必须同时填"
                            >
                              <Input placeholder="687218e0b6f5c1a2…" />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item
                              label="支付宝根证书 SN（证书模式）"
                              name={['alipay', 'alipayRootCertSn']}
                              extra="不填则按公钥模式请求"
                            >
                              <Input placeholder="687218e0b6f5c1a2…" />
                            </Form.Item>
                          </Col>
                        </Row>
                      </>
                    ),
                  },
                  {
                    key: 'wechat',
                    forceRender: true,
                    label: (
                      <Space>
                        <WechatOutlined style={{ color: '#07c160' }} />
                        微信支付
                      </Space>
                    ),
                    children: (
                      <>
                        <Form.Item
                          label="启用微信支付"
                          name={['wechat', 'enabled']}
                          valuePropName="checked"
                        >
                          <Switch />
                        </Form.Item>
                        <Form.Item
                          label="运行环境"
                          name={['wechat', 'environment']}
                        >
                          <Segmented
                            options={[
                              { label: '沙箱环境', value: 'sandbox' },
                              { label: '生产环境', value: 'production' },
                            ]}
                          />
                        </Form.Item>
                        <Row gutter={16}>
                          <Col span={12}>
                            <Form.Item
                              label="App ID"
                              name={['wechat', 'appId']}
                              rules={[
                                {
                                  required: true,
                                  message: '请输入微信 App ID',
                                },
                              ]}
                            >
                              <Input placeholder="wx0000000000000000" />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item
                              label="商户号"
                              name={['wechat', 'mchId']}
                            >
                              <Input placeholder="1600000000" />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Row gutter={16}>
                          <Col span={12}>
                            <Form.Item
                              label="API v3 密钥"
                              name={['wechat', 'apiV3Key']}
                            >
                              <Input.Password placeholder="32 位 API v3 密钥" />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item
                              label="证书序列号"
                              name={['wechat', 'serialNo']}
                            >
                              <Input placeholder="商户 API 证书序列号" />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Form.Item
                          label="商户私钥"
                          name={['wechat', 'privateKey']}
                        >
                          <Input.TextArea
                            rows={3}
                            placeholder="apiclient_key.pem 内容"
                          />
                        </Form.Item>
                        <Form.Item
                          label="支付回调地址"
                          name={['wechat', 'notifyUrl']}
                        >
                          <Input placeholder="https://your-domain.com/api/v1/public/payments/wechat/notify" />
                        </Form.Item>
                      </>
                    ),
                  },
                ]}
              />
            </Form>
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Space orientation="vertical" size={16} style={{ display: 'flex' }}>
            <Card
              title="支付诊断"
              extra={
                <Button
                  type="link"
                  size="small"
                  loading={health.isFetching}
                  onClick={() => health.refetch()}
                >
                  重新检测
                </Button>
              }
            >
              <Space
                orientation="vertical"
                size={12}
                style={{ display: 'flex' }}
              >
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="支付宝">
                    {health.data?.alipay.missing.length ? (
                      <Tag color="red">
                        缺 {health.data.alipay.missing.join('、')}
                      </Tag>
                    ) : (
                      <Tag icon={<CheckCircleOutlined />} color="success">
                        已配置（
                        {health.data?.alipay.mode === 'certificate'
                          ? '证书模式'
                          : '公钥模式'}
                        ／{health.data?.alipay.environment}）
                      </Tag>
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="微信支付">
                    {health.data?.wechat.missing.length ? (
                      <Tag color="red">
                        缺 {health.data.wechat.missing.join('、')}
                      </Tag>
                    ) : (
                      <Tag icon={<CheckCircleOutlined />} color="success">
                        已配置
                      </Tag>
                    )}
                  </Descriptions.Item>
                </Descriptions>
                {(health.data?.issues ?? []).map((issue) => (
                  <Alert key={issue} type="warning" showIcon title={issue} />
                ))}
                {health.data?.alipay.derivedPublicKey ? (
                  <div>
                    <div
                      style={{
                        fontSize: 12,
                        color: '#8c8c8c',
                        marginBottom: 4,
                      }}
                    >
                      从应用私钥推导出的应用公钥：贴到支付宝控制台「应用公钥」，
                      或与现有内容逐字对比 —— 不一致就是 invalid-signature
                      的原因
                    </div>
                    <Input.TextArea
                      readOnly
                      rows={3}
                      value={health.data.alipay.derivedPublicKey}
                      style={{ fontFamily: 'monospace', fontSize: 12 }}
                    />
                    <Button
                      size="small"
                      type="link"
                      onClick={() => {
                        navigator.clipboard
                          ?.writeText(
                            health.data?.alipay.derivedPublicKey ?? '',
                          )
                          .then(() => message.success('已复制'))
                          .catch(() =>
                            message.warning('复制失败，请手动选中复制'),
                          );
                      }}
                    >
                      复制应用公钥
                    </Button>
                  </div>
                ) : null}
              </Space>
            </Card>
            <Card
              title="官方组件"
              extra={
                <Button
                  type="link"
                  icon={<QrcodeOutlined />}
                  onClick={() => setQrOpen(true)}
                >
                  测试二维码
                </Button>
              }
            >
              <Space
                orientation="vertical"
                size={12}
                style={{ display: 'flex' }}
              >
                <Alert
                  showIcon
                  type="info"
                  title="支付宝"
                  description="已接入「电脑网站支付」（alipay.trade.page.pay），异步通知 RSA2 验签"
                />
                <Alert
                  showIcon
                  type="success"
                  title="微信支付"
                  description="已接入「Native 扫码」，回调平台证书验签 + APIv3 解密"
                />
              </Space>
            </Card>
            <Card title="安全提示">
              <ul
                style={{
                  paddingLeft: 18,
                  margin: 0,
                  color: '#595959',
                  lineHeight: 1.8,
                }}
              >
                <li>商户私钥只允许保存在服务端。</li>
                <li>回调必须验签并做幂等处理。</li>
                <li>生产环境请使用 KMS/Vault 管理密钥。</li>
              </ul>
            </Card>
          </Space>
        </Col>
      </Row>

      <Modal
        title="测试支付二维码"
        open={qrOpen}
        footer={null}
        onCancel={() => setQrOpen(false)}
        destroyOnHidden
      >
        <div style={{ textAlign: 'center', padding: 24 }}>
          <QRCode
            value={
              result?.qr_code || 'https://qr.alipay.com/ant-design-pro-demo'
            }
            size={220}
          />
          <p style={{ marginTop: 16, color: '#8c8c8c' }}>
            演示二维码，不会发起真实扣款。
          </p>
        </div>
      </Modal>
    </SettingPage>
  );
};

export default PaymentSettings;
