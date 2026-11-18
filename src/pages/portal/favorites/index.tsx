import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@umijs/max';
import { App, Button, Card, Empty, List, Space, Spin, Typography } from 'antd';
import PortalShell from '@/pages/portal/components/PortalShell';
import { listMyFavorites, removeFavorite } from '@/services/commerce/api';
import { formatDateTime } from '@/utils/datetime';

const _yuan = (cents?: number | null) =>
  cents == null ? '-' : `¥${(cents / 100).toFixed(2)}`;

/**
 * 我的收藏（买家）。
 *
 * 取消收藏直接调 `DELETE /public/products/{id}/favorite` —— 与详情页的星标
 * 是同一个接口，所以两处状态天然一致，不需要额外的同步逻辑。
 */
export default function PortalFavoritesPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const favorites = useQuery({
    queryKey: ['my-favorites'],
    queryFn: listMyFavorites,
  });

  const rows = favorites.data ?? [];

  return (
    <PortalShell title="我的收藏">
      <Card>
        {favorites.isLoading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Spin />
          </div>
        ) : rows.length === 0 ? (
          <Empty description="还没有收藏任何商品">
            <Link to="/products">
              <Button type="primary">去逛逛</Button>
            </Link>
          </Empty>
        ) : (
          <List
            dataSource={rows}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Link key="view" to={`/products/${item.product_id}`}>
                    查看商品
                  </Link>,
                  <Button
                    key="remove"
                    type="link"
                    danger
                    onClick={async () => {
                      await removeFavorite(item.product_id);
                      message.success('已取消收藏');
                      queryClient.invalidateQueries({
                        queryKey: ['my-favorites'],
                      });
                    }}
                  >
                    取消收藏
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  avatar={
                    item.product_image ? (
                      <img
                        src={item.product_image}
                        alt={item.product_name}
                        style={{
                          width: 64,
                          height: 64,
                          objectFit: 'cover',
                          borderRadius: 6,
                        }}
                      />
                    ) : null
                  }
                  title={
                    <Space size={8}>
                      <Link to={`/products/${item.product_id}`}>
                        {item.product_name}
                      </Link>
                      {item.product_status &&
                      item.product_status !== 'on_sale' ? (
                        <Typography.Text
                          type="secondary"
                          style={{ fontSize: 12 }}
                        >
                          （已下架）
                        </Typography.Text>
                      ) : null}
                    </Space>
                  }
                  description={
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {item.seller_shop_name || '—'} · 收藏于{' '}
                      {item.created_at ? formatDateTime(item.created_at) : '-'}
                    </Typography.Text>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>
    </PortalShell>
  );
}
