import { SafetyCertificateOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Input,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import PageShell from '@/components/PageShell';
import type { PlatformAuditRecord } from '@/services/api';
import { listPlatformAudit } from '@/services/api';

function summarise(value: Record<string, unknown> | null): string {
  if (!value) return '—';
  return Object.entries(value)
    .map(([key, raw]) => `${key}=${JSON.stringify(raw)}`)
    .join(' · ');
}

const columns: ColumnsType<PlatformAuditRecord> = [
  {
    title: '时间',
    dataIndex: 'created_at',
    width: 180,
    render: (value: string) => new Date(value).toLocaleString('zh-CN'),
  },
  {
    title: '操作',
    dataIndex: 'action',
    width: 220,
    render: (value: string, record) => (
      <Tag color="geekblue" title={value}>
        {record.action_label ?? value}
      </Tag>
    ),
  },
  {
    title: '对象',
    width: 200,
    render: (_, record) => (
      <Space size={4}>
        <Typography.Text>
          {record.target_type_label ?? record.target_type ?? '—'}
        </Typography.Text>
        <Typography.Text type="secondary">
          {record.target_label || '—'}
        </Typography.Text>
      </Space>
    ),
  },
  {
    title: '用户ID',
    dataIndex: 'actor_public_id',
    width: 220,
    render: (value: string | null) => value ?? '—',
  },
  {
    title: '用户名',
    dataIndex: 'actor_username',
    width: 140,
    render: (value: string | null, record) =>
      value ?? (record.actor_id ? '已删除' : '系统'),
  },
  {
    title: '变更后',
    render: (_, record) => (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {summarise(record.after)}
      </Typography.Text>
    ),
  },
];

export default function PlatformAuditPage() {
  const [keyword, setKeyword] = useState<string>();
  const audit = useQuery({
    queryKey: ['platform-audit', keyword],
    queryFn: () => listPlatformAudit({ pageSize: 50, keyword }),
  });

  return (
    <PageShell
      title="平台审计"
      subTitle="平台侧操作留痕：改全站配置会影响所有跟随系统的租户"
      icon={<SafetyCertificateOutlined />}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title="这里只显示平台级操作"
        description="平台行以 tenant_id 为空标识，租户侧审计查不到；反过来租户侧的操作也不会出现在这里。"
      />
      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          {/* 搜的是人能读的对象，不是内部自增 id */}
          <Input.Search
            allowClear
            placeholder="搜对象：租户名 / 用户名 / 商品名 / 订单号"
            style={{ width: 320 }}
            onSearch={(value) => setKeyword(value.trim() || undefined)}
          />
          <Button onClick={() => audit.refetch()}>刷新</Button>
        </Space>
        <Table<PlatformAuditRecord>
          rowKey="id"
          size="small"
          loading={audit.isLoading}
          columns={columns}
          dataSource={audit.data?.list ?? []}
          pagination={{ pageSize: 20 }}
        />
      </Card>
    </PageShell>
  );
}
