import { StarOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Input, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import PageShell from '@/components/PageShell';
import {
  listPlatformFavorites,
  type PlatformFavoriteRow,
} from '@/services/api';

/**
 * 全站商品收藏（跨租户只读）。
 *
 * 回答「谁收藏了什么」，所以人物列必须是 **用户ID + 用户名**；
 * 多一列「租户」用来区分同一商品在不同租户下的记录。
 */
export default function PlatformFavoritesPage() {
  const [keyword, setKeyword] = useState<string>();
  const favorites = useQuery({
    queryKey: ['platform-favorites', keyword],
    queryFn: () => listPlatformFavorites({ keyword }),
  });

  const columns: ColumnsType<PlatformFavoriteRow> = [
    {
      title: '租户',
      dataIndex: 'tenant_id',
      width: 90,
      render: (value: number | undefined) => value ?? '—',
    },
    { title: '商品', dataIndex: 'product_name', width: 260 },
    {
      title: '收藏用户',
      key: 'user',
      width: 260,
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
          </Typography.Text>
        </>
      ),
    },
    {
      title: '店铺',
      dataIndex: 'seller_shop_name',
      width: 160,
      render: (value: string | null | undefined) => value || '—',
    },
    {
      title: '收藏时间',
      dataIndex: 'created_at',
      width: 180,
      render: (value: string | null | undefined) =>
        value ? new Date(value).toLocaleString() : '—',
    },
  ];

  return (
    <PageShell
      title="商品收藏"
      subTitle="全站收藏记录（跨租户只读）：谁收藏了哪个商品"
      icon={<StarOutlined />}
    >
      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input.Search
            allowClear
            placeholder="搜商品名 / 用户名 / 用户ID / 店铺名"
            style={{ width: 320 }}
            onSearch={(value) => setKeyword(value.trim() || undefined)}
          />
          <Button onClick={() => favorites.refetch()}>刷新</Button>
        </Space>
        <Table<PlatformFavoriteRow>
          rowKey="id"
          size="middle"
          loading={favorites.isLoading}
          columns={columns}
          dataSource={favorites.data ?? []}
          pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 条` }}
        />
      </Card>
    </PageShell>
  );
}
