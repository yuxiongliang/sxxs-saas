import { ClockCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import PageShell from '@/components/PageShell';
import {
  cancelScheduledJob,
  listScheduledJobs,
  retryScheduledJob,
  runScheduledJob,
  type ScheduledJobRow,
} from '@/services/api';
import { formatDateTime } from '@/utils/datetime';

const STATUS_LABEL: Record<string, string> = {
  pending: '待执行',
  running: '执行中',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'blue',
  running: 'processing',
  done: 'green',
  failed: 'red',
  cancelled: 'default',
};

const KIND_LABEL: Record<string, string> = {
  auto_complete: '超时自动收货',
};

/** 时间按浏览器本地时区展示（后端存 UTC，直接截字符串会差 8 小时）。 */

/**
 * 定时任务（延时任务队列）。
 *
 * 平台运维要能回答三件事：还有没有任务在排队、worker 还活着吗、跑挂了怎么救。
 * 写操作（立即执行/取消/重试）都会进审计 —— 改的是"系统自动行为"，必须能追溯。
 */
export default function PlatformJobsPage() {
  const { message } = App.useApp();
  const [kind, setKind] = useState<string>();
  const [status, setStatus] = useState<string>();

  const jobs = useQuery({
    queryKey: ['platform-jobs', kind, status],
    queryFn: () => listScheduledJobs({ kind, status }),
    refetchInterval: 15_000,
  });

  const data = jobs.data;
  const alive = (data?.workers ?? []).some((worker) => worker.alive);

  const columns: ColumnsType<ScheduledJobRow> = [
    {
      title: '类型',
      dataIndex: 'kind',
      width: 150,
      render: (value: string) => (
        <Tag color="geekblue">{KIND_LABEL[value] ?? value}</Tag>
      ),
    },
    {
      title: '关联单号',
      width: 180,
      render: (_, record) =>
        record.ref_no ?? `${record.ref_type}#${record.ref_id}`,
    },
    {
      title: '计划执行时间',
      dataIndex: 'run_at',
      width: 170,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (value: string) => (
        <Tag color={STATUS_COLOR[value] ?? 'default'}>
          {STATUS_LABEL[value] ?? value}
        </Tag>
      ),
    },
    { title: '尝试', dataIndex: 'attempts', width: 70 },
    {
      title: '最后结果 / 错误',
      dataIndex: 'last_error',
      ellipsis: true,
      render: (value: string | null) => value ?? '—',
    },
    {
      title: '完成时间',
      dataIndex: 'finished_at',
      width: 170,
      render: (value: string | null) => formatDateTime(value),
    },
    {
      title: '操作',
      width: 220,
      render: (_, record) => (
        <Space size={0}>
          {['pending', 'failed'].includes(record.status) ? (
            <Popconfirm
              title="立即执行这个任务？"
              description="会马上触发自动收货逻辑（跳过等待时间）"
              onConfirm={async () => {
                try {
                  const result = await runScheduledJob(record.id);
                  message.success(`已执行：${result?.note ?? '完成'}`);
                  jobs.refetch();
                } catch (error) {
                  message.error((error as Error).message);
                }
              }}
            >
              <Button type="link" size="small">
                立即执行
              </Button>
            </Popconfirm>
          ) : null}
          {record.status === 'failed' ? (
            <Button
              type="link"
              size="small"
              onClick={async () => {
                await retryScheduledJob(record.id);
                message.success('已重新排队');
                jobs.refetch();
              }}
            >
              重试
            </Button>
          ) : null}
          {['pending', 'failed'].includes(record.status) ? (
            <Popconfirm
              title="取消这个任务？"
              description="取消后不会自动执行，需要人工处理该订单"
              onConfirm={async () => {
                await cancelScheduledJob(record.id);
                message.success('已取消');
                jobs.refetch();
              }}
            >
              <Button type="link" size="small" danger>
                取消
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <PageShell
      title="定时任务"
      subTitle="延时任务队列（自动收货等）：看计划、手动执行、取消、重试"
      icon={<ClockCircleOutlined />}
      extra={
        <Button icon={<ReloadOutlined />} onClick={() => jobs.refetch()}>
          刷新
        </Button>
      }
    >
      <Card>
        <Descriptions column={3} size="small" style={{ marginBottom: 16 }}>
          <Descriptions.Item label="任务进程（Worker）">
            {alive ? (
              <Tag color="green">在线</Tag>
            ) : (
              <Tag color="red">离线 / 心跳超时</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="待执行">
            {data?.summary.pending ?? 0}
          </Descriptions.Item>
          <Descriptions.Item label="失败">
            <Typography.Text
              type={(data?.summary.failed ?? 0) > 0 ? 'danger' : undefined}
            >
              {data?.summary.failed ?? 0}
            </Typography.Text>
          </Descriptions.Item>
        </Descriptions>

        {!alive ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="worker 心跳超时"
            description="自动收货等延时任务不会被执行。请检查进程：pm2 status / pm2 logs sxxs-jobs。"
          />
        ) : null}

        <Space wrap style={{ marginBottom: 16 }}>
          <Select
            allowClear
            placeholder="任务类型"
            style={{ width: 180 }}
            value={kind}
            onChange={setKind}
            options={(data?.kinds ?? []).map((value) => ({
              label: KIND_LABEL[value] ?? value,
              value,
            }))}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 150 }}
            value={status}
            onChange={setStatus}
            options={Object.entries(STATUS_LABEL).map(([value, label]) => ({
              label,
              value,
            }))}
          />
        </Space>

        <Table<ScheduledJobRow>
          rowKey="id"
          loading={jobs.isLoading}
          columns={columns}
          dataSource={data?.list ?? []}
          scroll={{ x: 1200 }}
          pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        />
      </Card>
    </PageShell>
  );
}
