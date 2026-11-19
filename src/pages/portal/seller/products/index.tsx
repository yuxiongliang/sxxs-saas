import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@umijs/max';
import {
  App,
  Button,
  Card,
  Image,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import {
  changeSellerProductStatus,
  deleteSellerProduct,
  listSellerProducts,
} from '@/services/commerce/api';
import type { SellerProductRecord } from '@/services/commerce/types';
import {
  labelOf,
  PRODUCT_STATUS,
  PRODUCT_TYPE,
  PRODUCT_TYPE_COLOR,
} from '@/utils/labels';
import SellerShell from '../components/SellerShell';

/**
 * 卖家侧适配器：**和运营端同一套向导**，只是换读写接口、去掉佣金与解锁。
 *
 * 归属校验在后端（`current_seller()`），所以这里不需要传权限码；
 * 卖家改在售商品会被后端打回待审核，前端只负责提示。
 */

/** 我的商品：列表 + 新增/编辑（与运营端同一套四步向导）。 */
export default function SellerProductsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [productType, setProductType] = useState<string>();

  const products = useQuery({
    queryKey: ['seller-products', productType],
    queryFn: () => listSellerProducts({ product_type: productType }),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['seller-products'] });

  const changeStatus = async (
    record: SellerProductRecord,
    status: 'off_sale' | 'pending_review',
  ) => {
    try {
      await changeSellerProductStatus(record.id, status);
      message.success(status === 'off_sale' ? '商品已下架' : '已重新提交审核');
      refresh();
    } catch (error) {
      message.error((error as Error)?.message || '操作失败');
    }
  };

  /** 软删除：商品从卖家列表与买家商城一起消失，历史订单/评价/审计照旧保留。 */
  const removeProduct = async (record: SellerProductRecord) => {
    try {
      await deleteSellerProduct(record.id);
      message.success('商品已删除');
      refresh();
    } catch (error) {
      message.error((error as Error)?.message || '删除失败');
    }
  };

  const columns: ColumnsType<SellerProductRecord> = [
    {
      title: '商品',
      dataIndex: 'name',
      render: (_, record) => (
        <div>
          <div style={{ fontWeight: 600 }}>{record.name}</div>
          {record.reject_reason ? (
            <div style={{ color: '#cf1322', fontSize: 12 }}>
              驳回原因：{record.reject_reason}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: '商品图片',
      dataIndex: 'main_image',
      width: 96,
      render: (value: string | null | undefined, record) =>
        value ? (
          <Image
            src={value}
            alt={record.name}
            width={64}
            height={64}
            style={{ objectFit: 'cover', borderRadius: 6 }}
          />
        ) : (
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 6,
              background: 'rgba(0,0,0,0.04)',
              color: '#bfbfbf',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            无图
          </div>
        ),
    },
    {
      title: '所在地',
      width: 150,
      render: (_, record) => {
        const location = [record.province, record.city, record.district]
          .filter(Boolean)
          .join(' ');
        return location ? (
          <span style={{ fontSize: 12 }}>{location}</span>
        ) : (
          // 没设所在地 = 不会出现在同城筛选/距离排序里，提醒卖家补
          <Tag color="orange">未设置</Tag>
        );
      },
    },
    {
      title: '类型',
      dataIndex: 'product_type',
      width: 110,
      render: (v: string) => (
        <Tag color={PRODUCT_TYPE_COLOR[v ?? 'physical'] ?? 'default'}>
          {PRODUCT_TYPE[v ?? 'physical'] ?? v ?? '—'}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (v: string) => <Tag>{labelOf(PRODUCT_STATUS, v)}</Tag>,
    },
    {
      title: '价格',
      dataIndex: 'price_cents',
      width: 110,
      render: (v: number) => `¥${(v / 100).toFixed(2)}`,
    },
    { title: '库存', dataIndex: 'stock', width: 90 },
    { title: '销量', dataIndex: 'sold_count', width: 80 },
    { title: '浏览', dataIndex: 'view_count', width: 80 },
    { title: '收藏', dataIndex: 'favorite_count', width: 80 },
    {
      title: '评分',
      key: 'rating',
      width: 110,
      render: (_, record) =>
        record.rating_avg == null
          ? '—'
          : `★ ${record.rating_avg.toFixed(1)}（${record.review_count ?? 0}）`,
    },
    {
      title: '操作',
      width: 240,
      render: (_, record) => (
        <Space size={0}>
          <Button
            type="link"
            size="small"
            onClick={() =>
              navigate(`/portal/seller/products/${record.id}/edit`)
            }
          >
            编辑
          </Button>
          {record.status === 'on_sale' ? (
            <Button
              type="link"
              size="small"
              danger
              onClick={() => changeStatus(record, 'off_sale')}
            >
              下架
            </Button>
          ) : null}
          {['rejected', 'draft', 'off_sale'].includes(record.status) ? (
            <Button
              type="link"
              size="small"
              onClick={() => changeStatus(record, 'pending_review')}
            >
              提交审核
            </Button>
          ) : null}
          <Popconfirm
            title="删除后商城与列表都不再展示，历史订单与评价保留。确定删除？"
            onConfirm={() => removeProduct(record)}
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <SellerShell title="我的商品">
      <Card>
        <Space style={{ marginBottom: 16 }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/portal/seller/products/create')}
            data-testid="seller-create-product"
          >
            新增商品
          </Button>
          <Select
            allowClear
            placeholder="类型"
            style={{ width: 130 }}
            value={productType}
            onChange={setProductType}
            options={Object.entries(PRODUCT_TYPE).map(([value, label]) => ({
              label,
              value,
            }))}
          />
        </Space>
        <Table
          rowKey="id"
          loading={products.isLoading}
          columns={columns}
          dataSource={products.data ?? []}
          pagination={false}
        />
      </Card>
    </SellerShell>
  );
}
