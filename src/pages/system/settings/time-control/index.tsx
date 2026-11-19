import { ClockCircleOutlined, SaveOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Divider,
  Form,
  InputNumber,
  Row,
  Typography,
} from 'antd';
import type React from 'react';
import { useEffect, useState } from 'react';
import InheritSwitch, {
  type SettingSource,
} from '@/pages/system/components/InheritSwitch';
import { getSetting, saveSetting } from '@/services/system/api';
import SettingPage from '../../components/SettingPage';

/**
 * 时间控制：订单链路上「等多久自动做什么」。
 *
 * 四个时间**全部按商品类型配置**（目前只开放实物商品，结构已按类型分组）：
 *
 * | 配置 | 作用 | 0 / 留空 |
 * | --- | --- | --- |
 * | 卖家发货时限 | 卖家订单列表显示剩余时间/已超时（**只提醒，不自动取消**） | 不限 |
 * | 快递自动确认收货 | 发货后 N 天买家未确认 → 自动完成（触发结算账期） | 不自动确认 |
 * | 自提自动确认收货 | 自提没有物流签收，需要单独兜底 | 不自动确认 |
 * | 确认收货后可申请售后 | 已完成订单 N 天内仍可申请售后 | 确认后不可申请 |
 * | 待支付自动关闭 | 下单后 N 天未支付 → 自动关闭并释放库存 | 不自动关闭 |
 *
 * 两条必须写在页面上的口径：
 * 1. **改完只影响新排的任务**：已经在倒计时里的订单沿用下单/发货时的时间；
 * 2. 全部填 0 = 关掉所有自动化（不会自动关单、不会自动收货），这是合法配置，不是故障。
 */

const PHYSICAL = 'physical';

interface TimeControlConfig {
  ship_days: number;
  auto_confirm_days: number;
  pickup_auto_confirm_days: number;
  refund_window_days: number;
  unpaid_close_days: number;
}

const FIELDS: Array<{
  key: keyof TimeControlConfig;
  label: string;
  hint: string;
  testId: string;
}> = [
  {
    key: 'ship_days',
    label: '卖家发货时限',
    hint: '买家付款后卖家应在此期限内发货。超时只在卖家订单列表标「已超时」，不自动取消订单。',
    testId: 'tc-ship-days',
  },
  {
    key: 'auto_confirm_days',
    label: '快递：发货后自动确认收货',
    hint: '买家不点确认也会到期自动完成，随后进入结算账期。',
    testId: 'tc-auto-confirm-days',
  },
  {
    key: 'pickup_auto_confirm_days',
    label: '自提：发货（备货完成）后自动确认收货',
    hint: '自提没有物流签收，需要独立兜底，否则订单会一直挂在「已发货」。',
    testId: 'tc-pickup-days',
  },
  {
    key: 'refund_window_days',
    label: '确认收货后可申请售后（天）',
    hint: '完成后 N 天内买家仍可申请售后；0 = 确认收货即结束交易，不再受理。',
    testId: 'tc-refund-days',
  },
  {
    key: 'unpaid_close_days',
    label: '待支付订单自动关闭（天）',
    hint: '下单后 N 天内未支付 → 自动关闭并释放库存（订单列表会显示截止时间）。',
    testId: 'tc-unpaid-days',
  },
];

const TimeControlPage: React.FC = () => {
  const [form] = Form.useForm<TimeControlConfig>();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [sourceOverride, setSourceOverride] = useState<SettingSource>();

  const { data, isLoading } = useQuery({
    queryKey: ['system-setting', 'time_control'],
    queryFn: () => getSetting('time_control'),
  });

  const effective = (data?.config?.[PHYSICAL] ??
    {}) as Partial<TimeControlConfig>;
  const source: SettingSource =
    sourceOverride ?? (data?.source === 'override' ? 'override' : 'inherit');
  const inheriting = source === 'inherit';

  useEffect(() => {
    if (!data) return;
    form.setFieldsValue({
      ship_days: effective.ship_days ?? 0,
      auto_confirm_days: effective.auto_confirm_days ?? 0,
      pickup_auto_confirm_days: effective.pickup_auto_confirm_days ?? 0,
      refund_window_days: effective.refund_window_days ?? 0,
      unpaid_close_days: effective.unpaid_close_days ?? 0,
    });
  }, [data, effective, form]);

  const handleSourceChange = async (next: SettingSource) => {
    setSourceOverride(next);
    try {
      await saveSetting('time_control', { source: next, enabled: true });
      await queryClient.invalidateQueries({
        queryKey: ['system-setting', 'time_control'],
      });
      message.success(
        next === 'inherit' ? '已切换为跟随平台' : '已切换为自定义',
      );
    } catch (error) {
      setSourceOverride(undefined);
      message.error((error as Error)?.message || '切换失败');
    }
  };

  const handleSave = async () => {
    if (inheriting) {
      message.info('当前跟随平台，无需保存；如需自定义请先切换到「自定义」');
      return;
    }
    try {
      setSaving(true);
      const values = await form.validateFields();
      await saveSetting('time_control', {
        source,
        enabled: true,
        config: { [PHYSICAL]: values },
      });
      message.success('时间控制已保存（只影响之后新产生的订单/任务）');
      await queryClient.invalidateQueries({
        queryKey: ['system-setting', 'time_control'],
      });
    } catch (error) {
      if ((error as { errorFields?: unknown })?.errorFields) return;
      message.error((error as Error)?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingPage
      title="时间控制"
      subTitle="发货时限 / 自动确认收货 / 售后窗口 / 待支付关闭"
      icon={<ClockCircleOutlined />}
      extra={
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          disabled={inheriting}
          onClick={handleSave}
          data-testid="time-control-save"
        >
          保存
        </Button>
      }
    >
      <InheritSwitch
        source={source}
        effectiveSource={data?.effective_source}
        inheritAllowed={data?.inherit_allowed !== false}
        platformActive={Boolean(data?.platform_active)}
        policyLocked={Boolean(data?.policy_locked)}
        onChange={handleSourceChange}
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title="这些时间决定系统什么时候「自动动手」"
        description="保存后只影响之后新产生的订单与任务；已经在倒计时里的订单仍按下单/发货时的时间执行。所有项填 0 表示关闭该自动化（不自动关单、不自动收货），属合法配置。"
      />

      <Card
        title="实物商品"
        loading={isLoading}
        data-testid="time-control-physical"
      >
        <Form form={form} layout="vertical" disabled={inheriting}>
          <Row gutter={24}>
            {FIELDS.map((item) => (
              <Col xs={24} md={12} xl={8} key={item.key}>
                <Form.Item
                  label={item.label}
                  name={item.key}
                  extra={item.hint}
                  rules={[
                    { required: true, message: '填 0 表示关闭该项' },
                    {
                      type: 'number',
                      min: 0,
                      max: 365,
                      message: '只能是 0-365 的整数',
                    },
                  ]}
                >
                  <InputNumber
                    min={0}
                    max={365}
                    precision={0}
                    addonAfter="天"
                    style={{ width: '100%' }}
                    data-testid={item.testId}
                  />
                </Form.Item>
              </Col>
            ))}
          </Row>
        </Form>

        <Divider plain style={{ margin: '4px 0 12px' }} />

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          说明：自动确认收货会触发结算账期（货款到期自动划入卖家钱包）；
          待支付关闭会同时释放库存与占用。
        </Typography.Text>
      </Card>
    </SettingPage>
  );
};

export default TimeControlPage;
