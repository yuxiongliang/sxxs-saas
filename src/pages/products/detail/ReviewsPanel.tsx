import { useQuery } from '@tanstack/react-query';
import {
  Card,
  Empty,
  Image,
  List,
  Pagination,
  Rate,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';
import { getProductReviews } from '@/services/commerce/api';

const PAGE_SIZE = 5;

/**
 * 商品详情页的评价区。
 *
 * 数据来自公开接口 `/public/products/{id}/reviews`：只返回 `visible` 的评价，
 * **匿名评价在这里已经脱敏**（连用户ID都不返回，只给「匿名买家」）。
 */
export default function ReviewsPanel({ productId }: { productId: number }) {
  const [page, setPage] = useState(1);
  const reviews = useQuery({
    queryKey: ['product-reviews', productId, page],
    queryFn: () =>
      getProductReviews(productId, {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
    enabled: Number.isFinite(productId),
  });

  const data = reviews.data;
  const total = data?.total ?? 0;

  return (
    <Card
      style={{ marginTop: 16 }}
      title={
        <Space size={8}>
          <span>商品评价</span>
          {data?.rating_avg != null ? (
            <>
              <Rate
                disabled
                allowHalf
                value={data.rating_avg}
                style={{ fontSize: 14 }}
              />
              <Typography.Text>{data.rating_avg.toFixed(2)} 分</Typography.Text>
            </>
          ) : null}
          <Typography.Text type="secondary">共 {total} 条</Typography.Text>
        </Space>
      }
    >
      {reviews.isLoading ? (
        <div style={{ padding: 32, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : total === 0 ? (
        <Empty description="还没有人评价这件商品" />
      ) : (
        <>
          <List
            dataSource={data?.list ?? []}
            renderItem={(item) => (
              <List.Item>
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  <Space size={8} wrap>
                    <Typography.Text strong>
                      {item.display_name}
                    </Typography.Text>
                    {item.is_anonymous ? <Tag>匿名</Tag> : null}
                    <Rate
                      disabled
                      value={item.rating}
                      style={{ fontSize: 13 }}
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {item.created_at
                        ? new Date(item.created_at).toLocaleString()
                        : ''}
                    </Typography.Text>
                  </Space>
                  {item.content ? (
                    <Typography.Paragraph style={{ marginBottom: 0 }}>
                      {item.content}
                    </Typography.Paragraph>
                  ) : null}
                  {item.media?.length ? (
                    <Space size={8} wrap>
                      {item.media.map((media) =>
                        media.type === 'video' ? (
                          /* biome-ignore lint/a11y/useMediaCaption: 买家上传的短视频没有字幕轨，补一个假 <track> 反而误导 */
                          <video
                            key={media.url}
                            src={media.url}
                            style={{
                              width: 88,
                              height: 88,
                              objectFit: 'cover',
                              borderRadius: 6,
                            }}
                            controls
                          />
                        ) : (
                          <Image
                            key={media.url}
                            src={media.url}
                            width={88}
                            height={88}
                            style={{ objectFit: 'cover', borderRadius: 6 }}
                          />
                        ),
                      )}
                    </Space>
                  ) : null}
                  {item.reply ? (
                    <div
                      style={{
                        background: 'var(--ant-color-fill-quaternary)',
                        borderRadius: 6,
                        padding: '8px 12px',
                      }}
                    >
                      <Typography.Text type="secondary">
                        卖家回复：
                      </Typography.Text>
                      {item.reply}
                    </div>
                  ) : null}
                </Space>
              </List.Item>
            )}
          />
          {total > PAGE_SIZE ? (
            <Pagination
              style={{ textAlign: 'center', marginTop: 12 }}
              current={page}
              pageSize={PAGE_SIZE}
              total={total}
              onChange={setPage}
              showSizeChanger={false}
            />
          ) : null}
        </>
      )}
    </Card>
  );
}
