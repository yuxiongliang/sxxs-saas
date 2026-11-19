import {
  EditOutlined,
  ReloadOutlined,
  ShoppingOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useAccess, useNavigate } from '@umijs/max';
import {
  App,
  Button,
  Card,
  Form,
  Image,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useState } from 'react';
import ListToolbar from '@/components/ListToolbar';
import {
  changeAdminProductStatus,
  listAdminCategories,
  listAdminProducts,
} from '@/services/commerce/api';
import type { ProductRecord } from '@/services/commerce/types';
import { formatDateTime } from '@/utils/datetime';
import {
  labelOf,
  PRODUCT_STATUS,
  PRODUCT_TYPE,
  PRODUCT_TYPE_COLOR,
} from '@/utils/labels';
import SettingPage from '../../system/components/SettingPage';

const statusColor = (status: string) =>
  ({
    on_sale: 'success',
    pending_review: 'gold',
    rejected: 'error',
    off_sale: 'default',
    draft: 'blue',
  })[status] ?? 'default';

const formatMoney = (cents?: number | null) =>
  typeof cents === 'number' ? `¥${(cents / 100).toFixed(2)}` : '—';

/** 每种状态下允许做的动作（与后端 PRODUCT_STATUS_FLOW 对应）。 */
type Action = {
  key: string;
  label: string;
  target: string;
  danger?: boolean;
  need: 'edit' | 'moderate';
  confirm: string;
};

const DELETE_ACTION: Action = {
  key: 'delete',
  label: '删除',
  target: 'deleted',
  danger: true,
  need: 'edit',
  confirm:
    '确定删除该商品？删除后商城与列表都不再展示（软删除，历史订单与审计仍保留）。',
};

const actionsFor = (status: string): Action[] => {
  switch (status) {
    case 'on_sale':
      return [
        {
          key: 'off',
          label: '下架',
          target: 'off_sale',
          danger: true,
          need: 'edit',
          confirm:
            '确定下架该商品？下架后买家商城不再展示，已生成的订单不受影响。',
        },
        DELETE_ACTION,
      ];
    case 'off_sale':
      return [
        {
          key: 'on',
          label: '重新上架',
          target: 'on_sale',
          need: 'edit',
          confirm: '确定重新上架？',
        },
        DELETE_ACTION,
      ];
    case 'pending_review':
      return [
        {
          key: 'approve',
          label: '审核通过并上架',
          target: 'on_sale',
          need: 'moderate',
          confirm: '审核通过并上架？会校验卖家状态与 SKU 库存。',
        },
        {
          key: 'reject',
          label: '驳回',
          target: 'rejected',
          danger: true,
          need: 'moderate',
          confirm: '确定驳回该商品？卖家需要重新提交。',
        },
        DELETE_ACTION,
      ];
    case 'rejected':
    case 'draft':
      return [
        {
          key: 'submit',
          label: '提交审核',
          target: 'pending_review',
          need: 'moderate',
          confirm: '将该商品提交待审核？',
        },
        DELETE_ACTION,
      ];
    default:
      return [];
  }
};

const ProductManagementPage: React.FC = () => {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const access = useAccess();
  const [rejectTarget, setRejectTarget] = useState<ProductRecord>();
  const [rejectForm] = Form.useForm<{ reason: string }>();
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string>();
  const [categoryId, setCategoryId] = useState<number>();
  // 商品类型筛选：当前只有实物，但字段先通着，免得以后加类型再改一遍
  const [productType, setProductType] = useState<string>();

  const categories = useQuery({
    queryKey: ['admin-categories'],
    queryFn: () => listAdminCategories(),
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-products', keyword, status, categoryId, productType],
    queryFn: () =>
      listAdminProducts({
        keyword: keyword || undefined,
        status,
        category_id: categoryId,
        product_type: productType,
      }),
  });

  /** 编辑商品改成**独立页面**（弹窗里填 5 步表单，滚动和校验都太挤） */
  const openEdit = (record: ProductRecord) => {
    navigate(`/commerce/products/${record.id}/edit`);
  };

  const runAction = async (record: ProductRecord, action: Action) => {
    try {
      await changeAdminProductStatus(record.id, action.target);
      message.success(`${action.label}成功`);
      refetch();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    try {
      const { reason } = await rejectForm.validateFields();
      await changeAdminProductStatus(rejectTarget.id, 'rejected', reason);
      message.success('已驳回，卖家可在商品中心看到原因');
      setRejectTarget(undefined);
      rejectForm.resetFields();
      refetch();
    } catch (error) {
      if ((error as { errorFields?: unknown }).errorFields) return;
      message.error((error as Error).message);
    }
  };

  const columns: ColumnsType<ProductRecord> = [
    {
      title: '卖家',
      dataIndex: 'seller_owner_username',
      width: 140,
      // 用户 > 卖家名：卖家名是店铺对外名，用户名才是账号主体
      render: (value: string | null, record) => (
        <div style={{ fontSize: 12 }}>
          <div>{value ?? '—'}</div>
          <div style={{ color: '#8c8c8c' }}>
            {record.seller_name ?? `卖家 #${record.seller_id}`}
          </div>
        </div>
      ),
    },
    {
      title: '店铺',
      dataIndex: 'shop_name',
      width: 160,
      render: (value: string | null, record) =>
        value ?? `店铺 #${record.shop_id}`,
    },
    {
      title: '类型',
      dataIndex: 'product_type',
      width: 110,
      render: (value: string | null) => (
        <Tag color={PRODUCT_TYPE_COLOR[value ?? 'physical'] ?? 'default'}>
          {PRODUCT_TYPE[value ?? 'physical'] ?? value ?? '—'}
        </Tag>
      ),
    },
    {
      // 和卖家中心同款：图片独立成列，商品名那列只放文字（表格更好扫）
      title: '商品图片',
      dataIndex: 'main_image',
      width: 96,
      render: (value: string | null | undefined, record) =>
        value ? (
          <Image
            src={value}
            alt={record.name}
            width={56}
            height={56}
            style={{ objectFit: 'cover', borderRadius: 6 }}
          />
        ) : (
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 6,
              background: 'rgba(0,0,0,0.04)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ShoppingOutlined style={{ color: '#1677ff', fontSize: 18 }} />
          </div>
        ),
    },
    {
      title: '商品',
      dataIndex: 'name',
      render: (value: string) => <div style={{ fontWeight: 600 }}>{value}</div>,
    },
    {
      title: '价格',
      width: 110,
      render: (_, record) => formatMoney(record.price_cents),
    },
    {
      title: '库存',
      width: 110,
      render: (_, record) => (
        <span
          title={`可用 ${record.stock ?? 0} / 锁定 ${record.locked_stock ?? 0}`}
        >
          {record.stock ?? 0}
          {(record.locked_stock ?? 0) > 0
            ? `（锁 ${record.locked_stock}）`
            : ''}
        </span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (value: string) => (
        <Tag color={statusColor(value)}>{labelOf(PRODUCT_STATUS, value)}</Tag>
      ),
    },
    {
      // 销量口径：已付款、未取消/退款的件数（services/catalog_stats.py）
      title: '销量',
      dataIndex: 'sold_count',
      width: 90,
      align: 'right',
      render: (value: number | undefined) => (
        <Typography.Text strong={Boolean(value)}>{value ?? 0}</Typography.Text>
      ),
    },
    {
      // 浏览 = 买家侧商品详情被打开的次数（刷新也会累计），
      // 不是广告曝光；列头必须写清楚，否则会被当成投放数据看。
      title: (
        <Tooltip title="买家打开商品详情页的次数（PV，刷新也会累计）。运营后台预览不计。">
          浏览
        </Tooltip>
      ),
      dataIndex: 'view_count',
      width: 90,
      align: 'right',
      render: (value: number | undefined) => value ?? 0,
    },
    {
      title: '收藏',
      dataIndex: 'favorite_count',
      width: 90,
      align: 'right',
      render: (value: number | undefined) => value ?? 0,
    },
    {
      title: '评分',
      key: 'rating',
      width: 120,
      render: (_, record) =>
        record.rating_avg == null ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Tooltip
            title={`${record.rating_avg.toFixed(2)} 分 · ${record.review_count ?? 0} 条评价`}
          >
            <Typography.Text>★ {record.rating_avg.toFixed(1)}</Typography.Text>
            <Typography.Text type="secondary" style={{ marginLeft: 6 }}>
              ({record.review_count ?? 0})
            </Typography.Text>
          </Tooltip>
        ),
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 150,
      render: (value: string | null) => formatDateTime(value),
    },
    {
      title: '操作',
      width: 260,
      render: (_, record) => (
        <Space size={0} wrap>
          {access.canProductEdit ? (
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEdit(record)}
            >
              编辑
            </Button>
          ) : null}
          {actionsFor(record.status)
            .filter((action) =>
              action.need === 'moderate'
                ? access.canProductModerate
                : access.canProductEdit,
            )
            .map((action) =>
              action.key === 'reject' ? (
                // 驳回要填原因：卖家中心会直接展示，不写原因只会反复重提
                <Button
                  key={action.key}
                  type="link"
                  size="small"
                  danger
                  onClick={() => {
                    setRejectTarget(record);
                    rejectForm.resetFields();
                  }}
                >
                  {action.label}
                </Button>
              ) : (
                <Popconfirm
                  key={action.key}
                  title={action.confirm}
                  onConfirm={() => runAction(record, action)}
                >
                  <Button type="link" size="small" danger={action.danger}>
                    {action.label}
                  </Button>
                </Popconfirm>
              ),
            )}
        </Space>
      ),
    },
  ];

  return (
    <SettingPage
      title="商品管理"
      subTitle="卖家提交的商品在这里审核、上下架、改价改库存"
      icon={<ShoppingOutlined />}
      extra={
        <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
          刷新
        </Button>
      }
    >
      <Card>
        <ListToolbar
          searchPlaceholder="搜商品名 / 卖家用户名 / 店铺名"
          keyword={keyword}
          onKeywordChange={setKeyword}
          onRefresh={() => refetch()}
          filters={
            <>
              <Select
                allowClear
                placeholder="状态"
                style={{ width: 130 }}
                value={status}
                onChange={setStatus}
                options={[
                  { label: '待审核', value: 'pending_review' },
                  { label: '在售', value: 'on_sale' },
                  { label: '已下架', value: 'off_sale' },
                  { label: '已驳回', value: 'rejected' },
                  { label: '草稿', value: 'draft' },
                  { label: '已删除', value: 'deleted' },
                ]}
              />
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="分类"
                style={{ width: 160 }}
                value={categoryId}
                onChange={setCategoryId}
                options={(categories.data ?? []).map((item) => ({
                  label: item.name,
                  value: item.id,
                }))}
              />
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
            </>
          }
        />
        <Table
          rowKey="id"
          loading={isLoading}
          columns={columns}
          dataSource={data ?? []}
          scroll={{ x: 1100 }}
          pagination={{ defaultPageSize: 10, showSizeChanger: true }}
        />
      </Card>

      <Modal
        title="驳回商品"
        open={Boolean(rejectTarget)}
        onCancel={() => setRejectTarget(undefined)}
        onOk={handleReject}
        okText="确认驳回"
        okButtonProps={{ danger: true }}
        destroyOnHidden
        forceRender
      >
        <Form form={rejectForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="驳回原因"
            name="reason"
            extra="卖家会在「我的商品」里看到这句话，写清楚要改什么"
            rules={[{ required: true, message: '请填写驳回原因' }]}
          >
            <Input.TextArea rows={3} maxLength={255} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </SettingPage>
  );
};

export default ProductManagementPage;
