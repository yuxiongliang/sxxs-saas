import {
  EditOutlined,
  ReloadOutlined,
  ShoppingOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useAccess } from '@umijs/max';
import {
  App,
  Button,
  Card,
  Divider,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useState } from 'react';
import AttachmentPicker from '@/components/AttachmentPicker';
import {
  changeAdminProductStatus,
  getAdminProduct,
  listAdminProducts,
  updateAdminProduct,
  updateAdminProductSku,
} from '@/services/commerce/api';
import type {
  ProductRecord,
  ProductSkuRecord,
} from '@/services/commerce/types';
import { labelOf, PRODUCT_STATUS } from '@/utils/labels';
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

const formatTime = (value?: string | null) =>
  value ? value.replace('T', ' ').slice(0, 16) : '—';

/** 每种状态下允许做的动作（与后端 PRODUCT_STATUS_FLOW 对应）。 */
type Action = {
  key: string;
  label: string;
  target: string;
  danger?: boolean;
  need: 'edit' | 'moderate';
  confirm: string;
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
      ];
    default:
      return [];
  }
};

const ProductManagementPage: React.FC = () => {
  const { message } = App.useApp();
  const access = useAccess();
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRecord>();
  const [skus, setSkus] = useState<ProductSkuRecord[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [form] = Form.useForm();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-products'],
    queryFn: listAdminProducts,
  });

  const openEdit = async (record: ProductRecord) => {
    setEditing(record);
    form.setFieldsValue(record);
    setSkus(record.skus ?? []);
    setEditOpen(true);
    // 列表里的 skus 只有概要，详情接口才有完整字段
    setLoadingDetail(true);
    try {
      const detail = await getAdminProduct(record.id);
      form.setFieldsValue(detail);
      setSkus(detail.skus ?? []);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleSave = async () => {
    if (!editing) return;
    try {
      const values = await form.validateFields();
      await updateAdminProduct(editing.id, {
        name: values.name,
        subtitle: values.subtitle,
        description: values.description,
        main_image: values.main_image,
      });
      message.success('商品资料已更新');
      setEditOpen(false);
      refetch();
    } catch (error) {
      if ((error as { errorFields?: unknown }).errorFields) return;
      message.error((error as Error).message);
    }
  };

  const saveSku = async (
    sku: ProductSkuRecord,
    patch: { price_cents?: number; stock?: number },
  ) => {
    if (!editing) return;
    try {
      await updateAdminProductSku(editing.id, sku.id, patch);
      message.success('SKU 已更新（库存变更已记账）');
      const detail = await getAdminProduct(editing.id);
      setSkus(detail.skus ?? []);
      refetch();
    } catch (error) {
      message.error((error as Error).message);
    }
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

  const columns: ColumnsType<ProductRecord> = [
    {
      title: '商品',
      dataIndex: 'name',
      render: (_, record) => (
        <Space>
          {record.main_image ? (
            <Image
              src={record.main_image}
              alt={record.name}
              width={40}
              height={40}
            />
          ) : (
            <ShoppingOutlined style={{ color: '#1677ff', fontSize: 18 }} />
          )}
          <div>
            <div style={{ fontWeight: 600 }}>{record.name}</div>
            <div style={{ color: '#8c8c8c', fontSize: 12 }}>
              {record.subtitle || '—'}
            </div>
          </div>
        </Space>
      ),
    },
    {
      title: '卖家 / 店铺',
      width: 180,
      render: (_, record) => (
        <div style={{ fontSize: 12 }}>
          <div>{record.seller_name ?? `卖家 #${record.seller_id}`}</div>
          <div style={{ color: '#8c8c8c' }}>
            {record.shop_name ?? `店铺 #${record.shop_id}`}
          </div>
        </div>
      ),
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
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 150,
      render: (value: string | null) => formatTime(value),
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
            .map((action) => (
              <Popconfirm
                key={action.key}
                title={action.confirm}
                onConfirm={() => runAction(record, action)}
              >
                <Button type="link" size="small" danger={action.danger}>
                  {action.label}
                </Button>
              </Popconfirm>
            ))}
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
        title="编辑商品"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={handleSave}
        confirmLoading={loadingDetail}
        destroyOnHidden
        forceRender
        width={720}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="商品名称"
            name="name"
            rules={[{ required: true, message: '请输入商品名称' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item label="副标题" name="subtitle">
            <Input />
          </Form.Item>
          <Form.Item label="商品描述" name="description">
            <Input.TextArea rows={3} placeholder="卖点、成色、规格等" />
          </Form.Item>
          <Form.Item
            label="主图"
            name="main_image"
            extra="点图片或按钮从附件中心选图"
          >
            <MainImageField />
          </Form.Item>
        </Form>

        <Divider titlePlacement="start" plain>
          SKU（价格 / 库存）
        </Divider>
        <Table<ProductSkuRecord>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={skus}
          locale={{ emptyText: '该商品还没有 SKU，无法上架' }}
          columns={[
            { title: 'SKU', dataIndex: 'name', width: 180 },
            {
              title: '价格（元）',
              width: 160,
              render: (_, sku) => (
                <InputNumber
                  min={0.01}
                  step={1}
                  defaultValue={sku.price_cents / 100}
                  style={{ width: '100%' }}
                  onBlur={(event) => {
                    const yuan = Number(event.target.value);
                    if (!Number.isFinite(yuan) || yuan <= 0) return;
                    const cents = Math.round(yuan * 100);
                    if (cents !== sku.price_cents) {
                      saveSku(sku, { price_cents: cents });
                    }
                  }}
                />
              ),
            },
            {
              title: '库存',
              width: 160,
              render: (_, sku) => (
                <InputNumber
                  min={sku.locked_stock}
                  step={1}
                  defaultValue={sku.stock}
                  style={{ width: '100%' }}
                  onBlur={(event) => {
                    const next = Number(event.target.value);
                    if (!Number.isFinite(next) || next === sku.stock) return;
                    saveSku(sku, { stock: next });
                  }}
                />
              ),
            },
            {
              title: '已锁定',
              dataIndex: 'locked_stock',
              width: 90,
            },
          ]}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          改价/改库存在失焦时自动保存；库存不能低于已锁定数量，每次变更都会写库存流水。
        </Typography.Text>
      </Modal>
    </SettingPage>
  );
};

/** 主图字段：点图弹附件中心。与品牌页的 ImageField 同款交互。 */
const MainImageField: React.FC<{
  value?: string;
  onChange?: (value: string) => void;
}> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [freshPreview, setFreshPreview] = useState<string>();
  const preview = freshPreview ?? value;
  return (
    <Space align="center" size={16}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          width: 96,
          height: 96,
          padding: 0,
          border: '1px dashed #d9d9d9',
          borderRadius: 8,
          background: '#fafafa',
          cursor: 'pointer',
          overflow: 'hidden',
        }}
      >
        {preview ? (
          <img
            src={preview}
            alt="商品主图"
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
            }}
          />
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            点击选图
          </Typography.Text>
        )}
      </button>
      <Space>
        <Button size="small" onClick={() => setOpen(true)}>
          {value ? '更换主图' : '选择主图'}
        </Button>
        {value ? (
          <Button
            size="small"
            danger
            onClick={() => {
              setFreshPreview(undefined);
              onChange?.('');
            }}
          >
            清除
          </Button>
        ) : null}
      </Space>
      <AttachmentPicker
        open={open}
        title="选择商品主图"
        onCancel={() => setOpen(false)}
        onSelect={(record) => {
          setFreshPreview(record.url);
          onChange?.(`/api/v1/attachments/public/${record.id}`);
        }}
      />
    </Space>
  );
};

export default ProductManagementPage;
