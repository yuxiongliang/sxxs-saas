import {
  Button,
  Image,
  Rate,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PersonCell } from '@/components/IdentityText';
import type { ReviewRecord } from '@/services/commerce/types';
import { formatDateTime } from '@/utils/datetime';

function formatTime(value?: string | null) {
  return value ? formatDateTime(value) : '-';
}

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  visible: { text: '已展示', color: 'green' },
  hidden: { text: '已隐藏', color: 'red' },
};

/** 大模型审核状态。当前接口是**空转**（未接模型），界面上不能装作有结论。 */
const MODERATION_LABEL: Record<string, { text: string; color: string }> = {
  skipped: { text: '未接入', color: 'default' },
  pending: { text: '待审', color: 'processing' },
  passed: { text: '通过', color: 'blue' },
  flagged: { text: '疑似违规', color: 'orange' },
  blocked: { text: '拦截', color: 'red' },
};

/**
 * 商品评价表格（运营 / 卖家 / 平台共用一套列）。
 *
 * 权限差异靠 props 控制，不复制三份表格：
 * * `canModerate` —— 只有运营 / 平台为 true（能隐藏、能回复）
 * * 卖家只能回复：传 `canReply` 但 `canModerate={false}`，隐藏按钮不出现
 *
 * 匿名评价：`is_anonymous` 只在这里显示成「匿名」标记，
 * **真实 用户ID + 用户名 仍然显示** —— 出纠纷时运营必须能定位到人。
 */
export default function ProductReviewTable({
  data,
  loading,
  canModerate = false,
  canReply = false,
  showTenant = false,
  onReply,
  onToggleStatus,
}: {
  data: ReviewRecord[];
  loading?: boolean;
  canModerate?: boolean;
  canReply?: boolean;
  showTenant?: boolean;
  onReply?: (record: ReviewRecord) => void;
  onToggleStatus?: (record: ReviewRecord) => void;
}) {
  const columns: ColumnsType<ReviewRecord> = [
    {
      title: '商品',
      key: 'product',
      width: 220,
      render: (_, record) => (
        <Space size={8}>
          {record.product_image ? (
            <img
              src={record.product_image}
              alt={record.product_name}
              style={{
                width: 36,
                height: 36,
                objectFit: 'cover',
                borderRadius: 4,
              }}
            />
          ) : null}
          <Typography.Text style={{ maxWidth: 170 }} ellipsis>
            {record.product_name}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '评价用户',
      key: 'user',
      width: 250,
      render: (_, record) => (
        <>
          <PersonCell
            publicId={record.user_public_id}
            username={record.user_username}
          />
          {record.is_anonymous ? (
            <Tag color="default" style={{ marginTop: 4 }}>
              匿名发布
            </Tag>
          ) : null}
        </>
      ),
    },
    {
      title: '评分',
      dataIndex: 'rating',
      width: 130,
      render: (value: number) => (
        <Rate disabled value={value} style={{ fontSize: 14 }} />
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
            ellipsis={{ rows: 3, expandable: true, symbol: '展开' }}
          >
            {record.content || (
              <Typography.Text type="secondary">
                （只打分，没写内容）
              </Typography.Text>
            )}
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
                      width: 72,
                      height: 72,
                      objectFit: 'cover',
                      borderRadius: 4,
                    }}
                    controls
                  />
                ) : (
                  <Image
                    key={media.url}
                    src={media.url}
                    width={72}
                    height={72}
                    style={{ objectFit: 'cover', borderRadius: 4 }}
                  />
                ),
              )}
            </Space>
          ) : null}
        </div>
      ),
    },
    ...(showTenant
      ? [
          {
            title: '租户',
            dataIndex: 'tenant_id',
            width: 80,
            render: (value: number | undefined) => value ?? '-',
          } as ColumnsType<ReviewRecord>[number],
        ]
      : []),
    {
      title: '状态',
      key: 'status',
      width: 150,
      render: (_, record) => {
        const status = STATUS_LABEL[record.status] ?? {
          text: record.status,
          color: 'default',
        };
        const moderation =
          MODERATION_LABEL[record.moderation_status ?? 'skipped'];
        return (
          <Space size={4} wrap>
            <Tag color={status.color}>{status.text}</Tag>
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
      title: '回复',
      key: 'reply',
      width: 200,
      render: (_, record) =>
        record.reply ? (
          <Typography.Text
            style={{ fontSize: 12 }}
            ellipsis={{ tooltip: record.reply }}
          >
            {record.reply}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      width: 170,
      render: (value: string | null) => formatTime(value),
    },
    ...(canModerate || canReply
      ? [
          {
            title: '操作',
            width: 160,
            render: (_: unknown, record: ReviewRecord) => (
              <Space size={4}>
                {canReply ? (
                  <Button size="small" onClick={() => onReply?.(record)}>
                    {record.reply ? '改回复' : '回复'}
                  </Button>
                ) : null}
                {/* 隐藏只有运营/平台能做；卖家这里永远不出现 */}
                {canModerate ? (
                  <Button
                    size="small"
                    danger={record.status === 'visible'}
                    onClick={() => onToggleStatus?.(record)}
                  >
                    {record.status === 'visible' ? '隐藏' : '恢复'}
                  </Button>
                ) : null}
              </Space>
            ),
          } as ColumnsType<ReviewRecord>[number],
        ]
      : []),
  ];

  return (
    <Table<ReviewRecord>
      rowKey="id"
      size="middle"
      loading={loading}
      columns={columns}
      dataSource={data}
      scroll={{ x: 1400 }}
      pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 条` }}
      expandable={{
        expandedRowRender: (record) => (
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            <Typography.Text type="secondary">完整内容：</Typography.Text>
            {record.content || '（无）'}
            {record.reply ? (
              <>
                <br />
                <Typography.Text type="secondary">回复：</Typography.Text>
                {record.reply}
              </>
            ) : null}
          </Typography.Paragraph>
        ),
        rowExpandable: (record) => Boolean(record.content || record.reply),
      }}
    />
  );
}
