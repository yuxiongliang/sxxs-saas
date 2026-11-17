import { ProfileOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  App,
  Button,
  Card,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import ListToolbar from '@/components/ListToolbar';
import {
  listWithdrawalsForReview,
  reviewWithdrawal,
} from '@/services/wallet/api';
import SettingPage from '../../system/components/SettingPage';

const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

const STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: '待审核', color: 'gold' },
  paid: { label: '已打款', color: 'green' },
  rejected: { label: '已驳回', color: 'red' },
};

const METHOD: Record<string, string> = {
  alipay: '支付宝',
  wechat: '微信',
  bank: '银行卡',
};

/**
 * 资金审核。
 *
 * 运营要审两笔钱：**卖家结算申请（Payout）** 与 **用户钱包提现（Withdrawal）**。
 * 放在同一个页面，是因为它们是同一套资金的出口 —— 分两个页面审，
 * 迟早出现"这边批了、那边又批一次"的重复打款。
 *
 * 本期先接钱包提现；卖家结算申请仍走原有的结算/提现流程（历史数据只读保留）。
 */
export default function FinanceWithdrawalsPage() {
  const { message } = App.useApp();
  const [status, setStatus] = useState<string>();

  const withdrawals = useQuery({
    queryKey: ['finance-withdrawals', status],
    queryFn: () => listWithdrawalsForReview(status),
  });

  const columns: ColumnsType<{
    id: number;
    user_public_id?: string | null;
    user_username?: string | null;
    amount_cents: number;
    method: string;
    account_name: string;
    account_no: string;
    status: string;
    note?: string | null;
    created_at?: string | null;
  }> = [
    {
      // 全站口径：人物只显示 用户ID + 用户名
      title: '用户ID',
      dataIndex: 'user_public_id',
      width: 210,
      render: (value: string | null) =>
        value ? (
          <Typography.Text code copyable={{ text: value }}>
            {value}
          </Typography.Text>
        ) : (
          '—'
        ),
    },
    {
      title: '用户名',
      dataIndex: 'user_username',
      width: 140,
      render: (value: string | null) => value ?? '—',
    },
    {
      title: '金额',
      dataIndex: 'amount_cents',
      width: 120,
      align: 'right',
      render: (value: number) => yuan(value),
    },
    {
      title: '收款信息',
      width: 260,
      render: (_, record) =>
        `${METHOD[record.method] ?? record.method} · ${record.account_name} · ${record.account_no}`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (value: string) => (
        <Tag color={STATUS[value]?.color ?? 'default'}>
          {STATUS[value]?.label ?? value}
        </Tag>
      ),
    },
    { title: '备注', dataIndex: 'note', ellipsis: true },
    {
      title: '操作',
      width: 180,
      render: (_, record) =>
        record.status === 'pending' ? (
          <Space size={0}>
            <Popconfirm
              title="确认已打款？"
              description="确认后从钱包余额扣除并记流水，不可撤销"
              onConfirm={async () => {
                await reviewWithdrawal(record.id, true, '运营审核通过并打款');
                message.success('已打款');
                withdrawals.refetch();
              }}
            >
              <Button type="link" size="small">
                通过并打款
              </Button>
            </Popconfirm>
            <Popconfirm
              title="驳回这笔提现？"
              description="冻结金额会解冻退回用户可用余额"
              onConfirm={async () => {
                await reviewWithdrawal(record.id, false, '运营驳回');
                message.success('已驳回');
                withdrawals.refetch();
              }}
            >
              <Button type="link" size="small" danger>
                驳回
              </Button>
            </Popconfirm>
          </Space>
        ) : null,
    },
  ];

  return (
    <SettingPage
      title="资金审核"
      subTitle="用户钱包提现审核（卖家结算申请仍走原结算流程）"
      icon={<ProfileOutlined />}
      extra={
        <Button icon={<ReloadOutlined />} onClick={() => withdrawals.refetch()}>
          刷新
        </Button>
      }
    >
      <Card>
        <ListToolbar
          searchPlaceholder="按状态筛选（下方下拉）"
          keyword=""
          onKeywordChange={() => undefined}
          onRefresh={() => withdrawals.refetch()}
          filters={
            <Select
              allowClear
              placeholder="提现状态"
              style={{ width: 150 }}
              value={status}
              onChange={setStatus}
              options={Object.entries(STATUS).map(([key, item]) => ({
                label: item.label,
                value: key,
              }))}
            />
          }
        />
        <Table
          rowKey="id"
          loading={withdrawals.isLoading}
          columns={columns}
          dataSource={withdrawals.data ?? []}
          scroll={{ x: 1300 }}
          pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        />
      </Card>
    </SettingPage>
  );
}
