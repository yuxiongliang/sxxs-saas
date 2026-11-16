import { AppstoreOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Input, Select, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import PageShell from '@/components/PageShell';
import { listPlatformProducts, type PlatformProductRow } from '@/services/api';

const STATUS_COLOR: Record<string, string> = {
  on_sale: 'green',
  pending_review: 'orange',
  off_sale: 'default',
  rejected: 'red',
  draft: 'default',
};

/**
 * 全站商品总览（跨租户只读）。
 *
 * 平台看的是**数据**：哪个租户的哪个商品卖得好、被看了多少次、被收藏多少、
 * 评分如何。这里没有编辑入口 —— 商品归租户运营管，平台越权改价只会制造事故。
 */
export default function PlatformProductsPage() {
  const [keyword, setKeyword] = useState<string>();
  const [status, setStatus] = useState<string>();
  const products = useQuery({
    queryKey: ['platform-products', keyword, status],
    queryFn: () => listPlatformProducts({ keyword, status }),
  });

  const columns: ColumnsType<PlatformProductRow> = [
    {
      title: '租户',
      dataIndex: 'tenant_name',
      width: 160,
      render: (value: string | null) => value ?? '—',
    },
    {
      title: '商品',
      key: 'name',
      width: 260,
      render: (_, record) => (
        <Space size={8}>
          {record.main_image ? (
            <img
              src={record.main_image}
              alt={record.name}
              style={{
                width: 36,
                height: 36,
                objectFit: 'cover',
                borderRadius: 4,
              }}
            />
          ) : null}
          <span>{record.name}</span>
        </Space>
      ),
    },
    {
      title: '卖家 / 店铺',
      key: 'seller',
      width: 200,
      render: (_, record) => (
        <div style={{ fontSize: 12 }}>
          <div>{record.seller_name ?? '—'}</div>
          <div style={{ color: '#999' }}>{record.shop_name ?? '—'}</div>
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (value: string) => (
        <Tag color={STATUS_COLOR[value] ?? 'default'}>{value}</Tag>
      ),
    },
    { title: '销量', dataIndex: 'sold_count', width: 90, align: 'right' },
    {
      title: (
        <Tooltip title="买家打开商品详情页的次数（PV，刷新也累计）">
          浏览
        </Tooltip>
      ),
      dataIndex: 'view_count',
      width: 90,
      align: 'right',
    },
    { title: '收藏', dataIndex: 'favorite_count', width: 90, align: 'right' },
    {
      title: '评分',
      key: 'rating',
      width: 110,
      render: (_, record) =>
        record.rating_avg == null
          ? '—'
          : `★ ${record.rating_avg.toFixed(1)}（${record.review_count}）`,
    },
  ];

  return (
    <PageShell
      title="商品总览"
      subTitle="全站商品与经营数据（跨租户只读）：销量 / 浏览 / 收藏 / 评分"
      icon={<AppstoreOutlined />}
    >
      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input.Search
            allowClear
            placeholder="搜商品名"
            style={{ width: 260 }}
            onSearch={(value) => setKeyword(value.trim() || undefined)}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 160 }}
            value={status}
            onChange={setStatus}
            options={[
              { label: '在售', value: 'on_sale' },
              { label: '待审核', value: 'pending_review' },
              { label: '已下架', value: 'off_sale' },
              { label: '已驳回', value: 'rejected' },
              { label: '草稿', value: 'draft' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => products.refetch()}>
            刷新
          </Button>
        </Space>
        <Table<PlatformProductRow>
          rowKey="id"
          size="middle"
          loading={products.isLoading}
          columns={columns}
          dataSource={products.data ?? []}
          pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 条` }}
        />
      </Card>
    </PageShell>
  );
}
