import { WalletOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Row,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import {
  getWallet,
  rechargeWallet,
  requestWithdrawal,
  type WalletTransactionRow,
  type WalletWithdrawalRow,
} from '@/services/wallet/api';
import PortalShell from '../components/PortalShell';

const yuan = (cents?: number | null) =>
  typeof cents === 'number' ? `¥${(cents / 100).toFixed(2)}` : '—';

const TX_LABEL: Record<string, string> = {
  recharge: '充值',
  pay: '余额支付',
  refund: '退款入账',
  transfer_in: '货款结算',
  withdraw: '提现打款',
  withdraw_reject: '提现驳回',
};

const WITHDRAW_STATUS: Record<string, string> = {
  pending: '待审核',
  paid: '已打款',
  rejected: '已驳回',
};

/**
 * 我的钱包。
 *
 * 统一钱包：买家（充值/退款/余额支付）与卖家（货款到期自动结算）用同一个账户；
 * 提现统一在这里申请，由**租户运营**在控制台「资金审核」处理。
 * 钱包按租户隔离 —— 在哪个商城充的钱只能在哪个商城花。
 */
export default function WalletPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [rechargeForm] = Form.useForm<{ amount: number }>();
  const [withdrawForm] = Form.useForm<{
    amount: number;
    method: string;
    account_name: string;
    account_no: string;
  }>();

  const wallet = useQuery({ queryKey: ['wallet'], queryFn: getWallet });
  const data = wallet.data;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['wallet'] });

  const txColumns: ColumnsType<WalletTransactionRow> = [
    { title: '时间', dataIndex: 'created_at', width: 170 },
    {
      title: '类型',
      dataIndex: 'type',
      width: 110,
      render: (value: string) => <Tag>{TX_LABEL[value] ?? value}</Tag>,
    },
    {
      title: '金额',
      dataIndex: 'amount_cents',
      width: 120,
      align: 'right',
      render: (value: number) => (
        <span style={{ color: value < 0 ? '#cf1322' : '#3f8600' }}>
          {value < 0 ? '-' : '+'}
          {yuan(Math.abs(value))}
        </span>
      ),
    },
    {
      title: '余额',
      dataIndex: 'balance_after',
      width: 120,
      align: 'right',
      render: (value: number) => yuan(value),
    },
    { title: '说明', dataIndex: 'remark', ellipsis: true },
  ];

  const withdrawalColumns: ColumnsType<WalletWithdrawalRow> = [
    { title: '时间', dataIndex: 'created_at', width: 170 },
    { title: '金额', dataIndex: 'amount_cents', width: 120, render: yuan },
    {
      title: '收款',
      width: 240,
      render: (_, record) =>
        `${record.method} · ${record.account_name} · ${record.account_no}`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: string) => (
        <Tag
          color={
            value === 'paid' ? 'green' : value === 'rejected' ? 'red' : 'gold'
          }
        >
          {WITHDRAW_STATUS[value] ?? value}
        </Tag>
      ),
    },
    { title: '备注', dataIndex: 'note', ellipsis: true },
  ];

  return (
    <PortalShell title="我的钱包">
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col xs={24} md={6}>
            <Statistic
              title="账户余额"
              value={yuan(data?.balance_cents ?? 0)}
              prefix={<WalletOutlined />}
            />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title="可用余额"
              value={yuan(data?.available_cents ?? 0)}
            />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title="提现审核冻结"
              value={yuan(data?.frozen_cents ?? 0)}
            />
          </Col>
          <Col xs={24} md={6}>
            <Button
              type="primary"
              data-testid="wallet-recharge"
              onClick={() => setRechargeOpen(true)}
            >
              充值
            </Button>
            <Button
              style={{ marginLeft: 8 }}
              data-testid="wallet-withdraw"
              onClick={() => setWithdrawOpen(true)}
            >
              提现
            </Button>
          </Col>
        </Row>
        <Typography.Paragraph
          type="secondary"
          style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}
        >
          钱包按商城隔离：本商城充值的余额只能在本商城使用与提现；
          卖家货款在账期到期后自动结算到本钱包。
        </Typography.Paragraph>
      </Card>

      <Card title="流水" size="small" style={{ marginBottom: 16 }}>
        <Table
          rowKey="id"
          size="small"
          columns={txColumns}
          dataSource={data?.transactions ?? []}
          pagination={{ defaultPageSize: 10 }}
        />
      </Card>

      <Card title="提现记录" size="small">
        <Table
          rowKey="id"
          size="small"
          columns={withdrawalColumns}
          dataSource={data?.withdrawals ?? []}
          pagination={{ defaultPageSize: 10 }}
        />
      </Card>

      <Modal
        title="充值（模拟）"
        open={rechargeOpen}
        onCancel={() => setRechargeOpen(false)}
        onOk={async () => {
          const values = await rechargeForm.validateFields();
          await rechargeWallet(
            Math.round(values.amount * 100),
            `ui-${Date.now()}`,
          );
          message.success('充值成功');
          setRechargeOpen(false);
          rechargeForm.resetFields();
          refresh();
        }}
        destroyOnHidden
      >
        <Form form={rechargeForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="充值金额（元）"
            name="amount"
            rules={[{ required: true, message: '请输入金额' }]}
          >
            <InputNumber min={1} precision={2} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="申请提现"
        open={withdrawOpen}
        onCancel={() => setWithdrawOpen(false)}
        onOk={async () => {
          const values = await withdrawForm.validateFields();
          await requestWithdrawal({
            amount_cents: Math.round(values.amount * 100),
            method: values.method as 'alipay' | 'wechat' | 'bank',
            account_name: values.account_name,
            account_no: values.account_no,
          });
          message.success('提现申请已提交，等待运营审核');
          setWithdrawOpen(false);
          withdrawForm.resetFields();
          refresh();
        }}
        destroyOnHidden
      >
        <Form form={withdrawForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="提现金额（元）"
            name="amount"
            rules={[{ required: true, message: '请输入金额' }]}
          >
            <InputNumber min={1} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            label="收款方式"
            name="method"
            initialValue="alipay"
            rules={[{ required: true }]}
          >
            <Radio.Group>
              <Radio.Button value="alipay">支付宝</Radio.Button>
              <Radio.Button value="wechat">微信</Radio.Button>
              <Radio.Button value="bank">银行卡</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            label="收款人姓名"
            name="account_name"
            rules={[{ required: true, message: '请输入收款人姓名' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            label="收款账号"
            name="account_no"
            rules={[{ required: true, message: '请输入收款账号' }]}
          >
            <Input placeholder="支付宝/微信账号或银行卡号" />
          </Form.Item>
        </Form>
      </Modal>
    </PortalShell>
  );
}
