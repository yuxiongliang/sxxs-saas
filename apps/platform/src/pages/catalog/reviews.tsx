import { CommentOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Image,
  Input,
  Modal,
  Rate,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import PageShell from '@/components/PageShell';
import {
  listPlatformReviews,
  type PlatformReviewRow,
  replyPlatformReview,
  setPlatformReviewStatus,
} from '@/services/api';

/** 大模型审核状态。接口已预留但**未接入模型**，界面上如实标注「未接入」。 */
const MODERATION: Record<string, { text: string; color: string }> = {
  skipped: { text: '未接入', color: 'default' },
  pending: { text: '待审', color: 'processing' },
  passed: { text: '通过', color: 'blue' },
  flagged: { text: '疑似违规', color: 'orange' },
  blocked: { text: '拦截', color: 'red' },
};

/**
 * 全站商品评价（跨租户）。
 *
 * 两件事：**抽查隐藏** + 回复。
 * 产品是「先发后审」：评价发布即展示，这里看到的就是线上真实内容；
 * AI 那一列目前恒为「未接入」—— 不要把它当成已生效的审核能力。
 */
export default function PlatformReviewsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [moderationStatus, setModerationStatus] = useState<string>();
  const [replying, setReplying] = useState<PlatformReviewRow>();
  const [replyText, setReplyText] = useState('');

  const reviews = useQuery({
    queryKey: ['platform-reviews', keyword, status, moderationStatus],
    queryFn: () =>
      listPlatformReviews({
        keyword,
        status,
        moderation_status: moderationStatus,
      }),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['platform-reviews'] });

  const columns: ColumnsType<PlatformReviewRow> = [
    {
      title: '租户',
      dataIndex: 'tenant_id',
      width: 80,
      render: (value: number | undefined) => value ?? '—',
    },
    { title: '商品', dataIndex: 'product_name', width: 200 },
    {
      title: '评价用户',
      key: 'user',
      width: 240,
      render: (_, record) => (
        <>
          <div>
            {record.user_public_id ? (
              <Typography.Text code copyable={{ text: record.user_public_id }}>
                {record.user_public_id}
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary">用户已删除</Typography.Text>
            )}
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {record.user_username ?? '-'}
            {record.is_anonymous ? '（匿名发布）' : ''}
          </Typography.Text>
        </>
      ),
    },
    {
      title: '评分',
      dataIndex: 'rating',
      width: 120,
      render: (value: number) => (
        <Rate disabled value={value} style={{ fontSize: 13 }} />
      ),
    },
    {
      title: '内容',
      key: 'content',
      width: 320,
      render: (_, record) => (
        <div>
          <Typography.Paragraph
            style={{ marginBottom: record.media?.length ? 6 : 0 }}
            ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}
          >
            {record.content || '（无内容）'}
          </Typography.Paragraph>
          {record.media?.length ? (
            <Space size={6} wrap>
              {record.media.map((media) =>
                media.type === 'video' ? (
                  /* biome-ignore lint/a11y/useMediaCaption: 买家上传的短视频没有字幕轨，补一个假 <track> 反而误导 */
                  <video
                    key={media.url}
                    src={media.url}
                    style={{
                      width: 64,
                      height: 64,
                      objectFit: 'cover',
                      borderRadius: 4,
                    }}
                    controls
                  />
                ) : (
                  <Image
                    key={media.url}
                    src={media.url}
                    width={64}
                    height={64}
                    style={{ objectFit: 'cover', borderRadius: 4 }}
                  />
                ),
              )}
            </Space>
          ) : null}
        </div>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 170,
      render: (_, record) => {
        const moderation = MODERATION[record.moderation_status ?? 'skipped'];
        return (
          <Space size={4} wrap>
            <Tag color={record.status === 'visible' ? 'green' : 'red'}>
              {record.status === 'visible' ? '已展示' : '已隐藏'}
            </Tag>
            <Tooltip
              title={
                record.moderation_note || '自动审核接口已预留，当前未接入模型'
              }
            >
              <Tag color={moderation.color}>AI：{moderation.text}</Tag>
            </Tooltip>
          </Space>
        );
      },
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      width: 170,
      render: (value: string | null | undefined) =>
        value ? new Date(value).toLocaleString() : '—',
    },
    {
      title: '操作',
      width: 160,
      render: (_, record) => (
        <Space size={4}>
          <Button
            size="small"
            onClick={() => {
              setReplying(record);
              setReplyText(record.reply ?? '');
            }}
          >
            {record.reply ? '改回复' : '回复'}
          </Button>
          <Button
            size="small"
            danger={record.status === 'visible'}
            onClick={async () => {
              const next = record.status === 'visible' ? 'hidden' : 'visible';
              await setPlatformReviewStatus(record.id, next);
              message.success(next === 'hidden' ? '已隐藏' : '已恢复');
              refresh();
            }}
          >
            {record.status === 'visible' ? '隐藏' : '恢复'}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <PageShell
      title="商品评价"
      subTitle="全站评价（跨租户）：先发后审，有问题的在这里隐藏；AI 审核接口已预留未接入"
      icon={<CommentOutlined />}
    >
      <Card>
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="评价为「先发后审」：发布即展示，AI 审核接口已预留但未接入模型"
          description="下面列表里 AI 状态均为「未接入」——请人工抽查，发现违规直接隐藏。隐藏后买家端立即不可见。"
        />
        <Space wrap style={{ marginBottom: 16 }}>
          <Input.Search
            allowClear
            placeholder="搜商品名 / 用户名 / 用户ID / 内容"
            style={{ width: 300 }}
            onSearch={(value) => setKeyword(value.trim() || undefined)}
          />
          <Select
            allowClear
            placeholder="展示状态"
            style={{ width: 140 }}
            value={status}
            onChange={setStatus}
            options={[
              { label: '已展示', value: 'visible' },
              { label: '已隐藏', value: 'hidden' },
            ]}
          />
          <Select
            allowClear
            placeholder="AI 审核状态"
            style={{ width: 150 }}
            value={moderationStatus}
            onChange={setModerationStatus}
            options={[
              { label: '未接入', value: 'skipped' },
              { label: '待审', value: 'pending' },
              { label: '通过', value: 'passed' },
              { label: '疑似违规', value: 'flagged' },
              { label: '拦截', value: 'blocked' },
            ]}
          />
          <Button onClick={() => reviews.refetch()}>刷新</Button>
        </Space>
        <Table<PlatformReviewRow>
          rowKey="id"
          size="middle"
          loading={reviews.isLoading}
          columns={columns}
          dataSource={reviews.data ?? []}
          scroll={{ x: 1500 }}
          pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 条` }}
        />
      </Card>

      <Modal
        title="回复评价"
        open={Boolean(replying)}
        onCancel={() => setReplying(undefined)}
        onOk={async () => {
          if (!replying) return;
          if (!replyText.trim()) {
            message.warning('回复内容不能为空');
            return;
          }
          await replyPlatformReview(replying.id, replyText.trim());
          message.success('已回复');
          setReplying(undefined);
          setReplyText('');
          refresh();
        }}
        okText="提交回复"
      >
        <Input.TextArea
          rows={4}
          maxLength={1000}
          showCount
          value={replyText}
          onChange={(event) => setReplyText(event.target.value)}
        />
      </Modal>
    </PageShell>
  );
}
