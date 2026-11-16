import { Button, Space, Table, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CopyableText } from '@/components/IdentityText';
import type { FavoriteRecord } from '@/services/commerce/types';

function formatTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '-';
}

/**
 * 商品收藏表格（运营 / 卖家 / 平台共用一套列）。
 *
 * 全站口径：**人物一律显示「用户ID + 用户名」**，裸自增 id 不出现在界面上。
 * 需要多一列「租户」时传 `showTenant`（平台端跨租户视图用）。
 */
export default function ProductFavoriteTable({
  data,
  loading,
  showTenant = false,
  onRemove,
}: {
  data: FavoriteRecord[];
  loading?: boolean;
  showTenant?: boolean;
  onRemove?: (record: FavoriteRecord) => void;
}) {
  const columns: ColumnsType<FavoriteRecord> = [
    {
      title: '商品',
      key: 'product',
      width: 260,
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
          <Typography.Text style={{ maxWidth: 200 }} ellipsis>
            {record.product_name}
          </Typography.Text>
        </Space>
      ),
    },
    {
      // 全站硬规则：用户ID + 用户名，绝不显示裸 user_id
      title: '收藏用户',
      key: 'user',
      width: 260,
      render: (_, record) => (
        <>
          <div>
            <CopyableText
              text={record.user_public_id}
              placeholder="用户已删除"
            />
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
      render: (value: string | null | undefined) => value || '-',
    },
    ...(showTenant
      ? [
          {
            title: '租户',
            dataIndex: 'tenant_id',
            width: 90,
            render: (value: number | undefined) => value ?? '-',
          } as ColumnsType<FavoriteRecord>[number],
        ]
      : []),
    {
      title: '收藏时间',
      dataIndex: 'created_at',
      width: 170,
      render: (value: string | null) => formatTime(value),
    },
    ...(onRemove
      ? [
          {
            title: '操作',
            width: 100,
            render: (_: unknown, record: FavoriteRecord) => (
              <Button size="small" danger onClick={() => onRemove(record)}>
                取消收藏
              </Button>
            ),
          } as ColumnsType<FavoriteRecord>[number],
        ]
      : []),
  ];

  return (
    <Table<FavoriteRecord>
      rowKey="id"
      size="middle"
      loading={loading}
      columns={columns}
      dataSource={data}
      pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 条` }}
      locale={{
        emptyText: <Tooltip title="还没有买家收藏商品">暂无收藏记录</Tooltip>,
      }}
    />
  );
}
