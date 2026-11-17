import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import ProductEditor, {
  type ProductWizardAdapter,
} from '@/pages/commerce/products/components/ProductEditor';
import {
  changeSellerProductStatus,
  createSellerProduct,
  getSellerProduct,
  listSellerCategories,
  listSellerProducts,
  saveSellerProductSpecs,
  updateSellerProduct,
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
const sellerAdapter: ProductWizardAdapter = {
  load: getSellerProduct,
  categories: () => listSellerCategories(),
  saveBasic: async (id, payload) => {
    const body = payload as Parameters<typeof updateSellerProduct>[1];
    if (id) {
      const result = await updateSellerProduct(id, body);
      if (result.bounced_to_review) {
        // 由调用方的 message 提示，这里只回传
      }
      return id;
    }
    const created = await createSellerProduct(
      payload as Parameters<typeof createSellerProduct>[0],
    );
    return created.id;
  },
  saveSpecs: async (id, payload) => {
    await saveSellerProductSpecs(id, payload);
  },
  // 卖家没有佣金设置与解锁能力：showCommission 默认 false
};

/** 我的商品：列表 + 新增/编辑（与运营端同一套四步向导）。 */
export default function SellerProductsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<SellerProductRecord>();
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
      width: 200,
      render: (_, record) => (
        <Space size={0}>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setEditing(record);
              setEditOpen(true);
            }}
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
            onClick={() => setCreateOpen(true)}
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

      {/* 与运营端「编辑商品」同一套四步向导：类型 → 基础信息 → 规格 → 详情 */}
      <ProductEditor
        open={createOpen}
        mode="create"
        adapter={sellerAdapter}
        onClose={() => setCreateOpen(false)}
        onSaved={refresh}
      />

      <ProductEditor
        open={editOpen}
        productId={editing?.id}
        adapter={sellerAdapter}
        onClose={() => {
          setEditOpen(false);
          setEditing(undefined);
        }}
        onSaved={refresh}
      />
    </SellerShell>
  );
}
