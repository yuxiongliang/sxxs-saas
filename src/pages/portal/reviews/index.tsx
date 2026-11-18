import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Card,
  Empty,
  Image,
  Rate,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import type { ReviewableItem } from '@/components/ReviewFormModal';
import ReviewFormModal from '@/components/ReviewFormModal';
import PortalShell from '@/pages/portal/components/PortalShell';
import { listMyReviews, listReviewableItems } from '@/services/commerce/api';
import type { ReviewRecord } from '@/services/commerce/types';
import { formatDateTime } from '@/utils/datetime';

/**
 * 我的评价（买家）。
 *
 * 两个 Tab：
 * * 待评价 —— 订单已完成但还没评的订单项（一个订单项只能评一次）
 * * 已评价 —— 自己写过的评价，能看到卖家的回复
 */
export default function PortalReviewsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('pending');
  const [target, setTarget] = useState<ReviewableItem>();

  const pending = useQuery({
    queryKey: ['my-reviewable'],
    queryFn: listReviewableItems,
  });
  const mine = useQuery({ queryKey: ['my-reviews'], queryFn: listMyReviews });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['my-reviewable'] });
    queryClient.invalidateQueries({ queryKey: ['my-reviews'] });
  };

  const reviewColumns: ColumnsType<ReviewRecord> = [
    {
      title: '商品',
      dataIndex: 'product_name',
      width: 240,
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
      title: '我的评价',
      key: 'content',
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <span>
            {record.content || (
              <span style={{ color: '#999' }}>（只打分，没写内容）</span>
            )}
          </span>
          {record.media?.length ? (
            <Space size={6} wrap>
              {record.media.map((media) =>
                media.type === 'video' ? (
                  /* biome-ignore lint/a11y/useMediaCaption: 买家上传的短视频没有字幕轨，补一个假 <track> 反而误导 */
                  <video
                    key={media.url}
                    src={media.url}
                    style={{
                      width: 56,
                      height: 56,
                      objectFit: 'cover',
                      borderRadius: 4,
                    }}
                    controls
                  />
                ) : (
                  <Image
                    key={media.url}
                    src={media.url}
                    width={56}
                    height={56}
                    style={{ objectFit: 'cover', borderRadius: 4 }}
                  />
                ),
              )}
            </Space>
          ) : null}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: string) => (
        <Tag color={value === 'visible' ? 'green' : 'red'}>
          {value === 'visible' ? '已展示' : '已隐藏'}
        </Tag>
      ),
    },
    {
      title: '卖家回复',
      dataIndex: 'reply',
      width: 200,
      render: (value: string | null) => value || '—',
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      width: 170,
      render: (value: string | null) => (value ? formatDateTime(value) : '-'),
    },
  ];

  return (
    <PortalShell title="我的评价">
      <Card>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'pending',
              label: `待评价（${pending.data?.length ?? 0}）`,
              children: pending.isLoading ? (
                <Spin />
              ) : (pending.data?.length ?? 0) === 0 ? (
                <Empty description="没有待评价的订单，先去确认收货吧" />
              ) : (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {pending.data?.map((item) => (
                    <Card key={item.order_item_id} size="small">
                      <Space size={12} style={{ width: '100%' }}>
                        {item.image ? (
                          <img
                            src={item.image}
                            alt={item.product_name}
                            style={{
                              width: 56,
                              height: 56,
                              objectFit: 'cover',
                              borderRadius: 6,
                            }}
                          />
                        ) : null}
                        <div style={{ flex: 1 }}>
                          <div>{item.product_name}</div>
                          <div style={{ color: '#999', fontSize: 12 }}>
                            {item.sku_name}
                          </div>
                        </div>
                        <Button
                          type="primary"
                          onClick={() => {
                            setTarget(item);
                            message.info('评价后前台立即可见');
                          }}
                        >
                          去评价
                        </Button>
                      </Space>
                    </Card>
                  ))}
                </Space>
              ),
            },
            {
              key: 'done',
              label: `已评价（${mine.data?.length ?? 0}）`,
              children: (
                <Table<ReviewRecord>
                  rowKey="id"
                  size="middle"
                  loading={mine.isLoading}
                  columns={reviewColumns}
                  dataSource={mine.data ?? []}
                  pagination={{ pageSize: 10 }}
                  locale={{ emptyText: '还没有写过评价' }}
                />
              ),
            },
          ]}
        />
      </Card>

      <ReviewFormModal
        item={target}
        onClose={() => setTarget(undefined)}
        onDone={() => {
          setTarget(undefined);
          setTab('done');
          refresh();
        }}
      />
    </PortalShell>
  );
}
