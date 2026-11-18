import { AuditOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  Descriptions,
  Drawer,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  theme,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useState } from 'react';
import type { AuditLogRecord } from '@/services/system/audit';
import { listAuditActions, listAuditLogs } from '@/services/system/audit';
import { formatDateTime } from '@/utils/datetime';
import SettingPage from '../components/SettingPage';

const actionColor = (action: string) =>
  action.includes('created')
    ? 'blue'
    : action.includes('paid')
      ? 'green'
      : action.includes('cancel') ||
          action.includes('reject') ||
          action.includes('suspend')
        ? 'red'
        : action.includes('moderated')
          ? 'volcano'
          : 'default';

const AuditPage: React.FC = () => {
  const [action, setAction] = useState<string>();
  const [keyword, setKeyword] = useState<string>();
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AuditLogRecord>();
  const { token } = theme.useToken();

  const actions = useQuery({
    queryKey: ['audit-actions'],
    queryFn: listAuditActions,
  });
  const logs = useQuery({
    queryKey: ['audit-logs', action, keyword, page],
    queryFn: () =>
      listAuditLogs({
        current: page,
        pageSize: 20,
        action,
        keyword,
      }),
  });

  const columns: ColumnsType<AuditLogRecord> = [
    {
      // 裸 actor_id 对运营没意义；用对外用户编号（与用户管理页同一套）
      title: '用户ID',
      dataIndex: 'actor_public_id',
      width: 220,
      render: (value: string | null) =>
        value ? (
          <Typography.Text code copyable={{ text: value }}>
            {value}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: '用户名',
      dataIndex: 'actor_username',
      width: 140,
      render: (value: string | null, record) =>
        value ?? (
          <Typography.Text type="secondary">
            {record.actor_id ? '已删除' : '系统'}
          </Typography.Text>
        ),
    },
    {
      title: '动作',
      dataIndex: 'action',
      width: 220,
      render: (value: string, record) => (
        <Tag color={actionColor(value)} title={value}>
          {record.action_label ?? value}
        </Tag>
      ),
    },
    {
      // 以前这里拼的是 `#{target_id}` —— 裸自增主键，既不可读也违反全站口径。
      // 现在给「中文类型 + 人能读的对象」（订单号 / 商品名 / 用户ID+用户名…）。
      title: '对象',
      key: 'target',
      width: 240,
      render: (_, record) => (
        <Space size={4}>
          <Typography.Text>
            {record.target_type_label ?? record.target_type}
          </Typography.Text>
          <Typography.Text
            type="secondary"
            copyable={
              record.target_label ? { text: record.target_label } : false
            }
          >
            {record.target_label || '目标已删除'}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      width: 190,
      render: (value: string) => formatDateTime(value),
    },
    // 租户列已删除：这个页面本来就是当前租户自己的审计，一列相同的值没信息量
    {
      title: '来源 IP',
      dataIndex: 'ip',
      width: 140,
      render: (value: string) => value || '-',
    },
    {
      title: '操作',
      width: 90,
      render: (_, record) => (
        <Button type="link" size="small" onClick={() => setDetail(record)}>
          详情
        </Button>
      ),
    },
  ];

  return (
    <SettingPage
      title="审计日志"
      subTitle="订单支付、退款、提现结算与权限变更的全链路留痕"
      icon={<AuditOutlined />}
      extra={
        <Button icon={<ReloadOutlined />} onClick={() => logs.refetch()}>
          刷新
        </Button>
      }
    >
      <Card>
        <Space style={{ marginBottom: 16 }} wrap>
          <Select
            allowClear
            showSearch
            placeholder="动作"
            style={{ width: 240 }}
            value={action}
            onChange={(value) => {
              setAction(value);
              setPage(1);
            }}
            options={actions.data ?? []}
            optionFilterProp="label"
          />
          {/* 不能让人去填内部自增 id：搜的是订单号 / 商品名 / 用户名 / 用户ID */}
          <Input.Search
            allowClear
            placeholder="搜对象：订单号 / 商品名 / 用户名 / 用户ID"
            style={{ width: 320 }}
            onSearch={(value) => {
              setKeyword(value.trim() || undefined);
              setPage(1);
            }}
          />
        </Space>
        <Table
          rowKey="id"
          loading={logs.isLoading}
          columns={columns}
          dataSource={logs.data?.list ?? []}
          pagination={{
            current: page,
            pageSize: 20,
            total: logs.data?.total ?? 0,
            onChange: setPage,
            showSizeChanger: false,
          }}
        />
      </Card>

      <Drawer
        title={`审计详情 #${detail?.id ?? ''}`}
        open={!!detail}
        width={640}
        onClose={() => setDetail(undefined)}
      >
        {detail ? (
          <>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="动作">
                {detail.action_label ?? detail.action}
                <Typography.Text
                  type="secondary"
                  style={{ marginLeft: 8, fontSize: 12 }}
                >
                  {detail.action}
                </Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="对象">
                {detail.target_type_label ?? detail.target_type}
                <Typography.Text style={{ marginLeft: 8 }}>
                  {detail.target_label || '目标已删除'}
                </Typography.Text>
                {/* 内部编号只放在详情里供技术排查，列表上不再展示 */}
                <Typography.Text
                  type="secondary"
                  style={{ marginLeft: 8, fontSize: 12 }}
                >
                  内部 ID {detail.target_id}
                </Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="操作人">
                {detail.actor_username ?? (detail.actor_id ? '已删除' : '系统')}
                {detail.actor_public_id ? (
                  <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                    {detail.actor_public_id}
                  </Typography.Text>
                ) : null}
              </Descriptions.Item>
              <Descriptions.Item label="IP">
                {detail.ip ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Trace">
                {detail.trace_id ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="时间">
                {formatDateTime(detail.created_at)}
              </Descriptions.Item>
            </Descriptions>
            <Typography.Title level={5} style={{ marginTop: 16 }}>
              变更前
            </Typography.Title>
            <pre
              style={{
                background: token.colorFillQuaternary,
                padding: 12,
                borderRadius: 8,
              }}
            >
              {JSON.stringify(detail.before ?? null, null, 2)}
            </pre>
            <Typography.Title level={5}>变更后</Typography.Title>
            <pre
              style={{
                background: token.colorFillQuaternary,
                padding: 12,
                borderRadius: 8,
              }}
            >
              {JSON.stringify(detail.after ?? null, null, 2)}
            </pre>
          </>
        ) : null}
      </Drawer>
    </SettingPage>
  );
};

export default AuditPage;
