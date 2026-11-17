import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import MediaField from '@/components/MediaField';
import type { RichTextValue } from '@/components/RichTextEditor';
import RichTextEditor from '@/components/RichTextEditor';
import {
  changeSellerProductStatus,
  createSellerProduct,
  listSellerProducts,
  updateSellerProduct,
} from '@/services/commerce/api';
import type { SellerProductRecord } from '@/services/commerce/types';
import {
  labelOf,
  OPEN_PRODUCT_TYPES,
  PRODUCT_STATUS,
  PRODUCT_TYPE,
  PRODUCT_TYPE_COLOR,
} from '@/utils/labels';
import SellerShell from '../components/SellerShell';

/** 我的商品：商品列表 + 新增/编辑（含富文本详情）。 */
export default function SellerProductsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<SellerProductRecord>();
  const [richDesc, setRichDesc] = useState<RichTextValue | null>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [productType, setProductType] = useState<string>();

  const products = useQuery({
    queryKey: ['seller-products', productType],
    queryFn: () => listSellerProducts({ product_type: productType }),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['seller-products'] });

  const handleCreate = async () => {
    const values = await createForm.validateFields();
    await createSellerProduct({
      name: values.name,
      // 类型创建时确定、之后不可改；只有实物可选（其余显示待开发）
      product_type: values.product_type ?? 'physical',
      price_cents: Math.round(values.price * 100),
      stock: values.stock,
      main_image: values.main_image || undefined,
      video_url: values.video_url || undefined,
    });
    message.success('商品已提交审核');
    setCreateOpen(false);
    createForm.resetFields();
    refresh();
  };

  const openEdit = (record: SellerProductRecord) => {
    setEditing(record);
    // 富文本回显：doc 优先；老数据没有 doc 就留空（纯文本仍在 description 里兜底）
    setRichDesc(
      record.description_format === 'doc' && record.description_doc
        ? { doc: record.description_doc, html: record.description_html ?? '' }
        : null,
    );
    editForm.setFieldsValue({
      name: record.name,
      description: record.description ?? '',
      main_image: record.main_image ?? '',
      video_url: record.video_url ?? '',
      price_yuan: record.price_cents / 100,
      stock: record.stock,
      commission_percent:
        record.commission_bps === null || record.commission_bps === undefined
          ? undefined
          : record.commission_bps / 100,
    });
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    if (!editing) return;
    try {
      const values = await editForm.validateFields();
      const result = await updateSellerProduct(editing.id, {
        name: values.name,
        description: values.description,
        ...(richDesc
          ? { description_doc: richDesc.doc, description_html: richDesc.html }
          : {}),
        main_image: values.main_image || undefined,
        video_url: values.video_url || undefined,
        price_cents: Math.round(Number(values.price_yuan) * 100),
        stock: Number(values.stock),
        ...(typeof values.commission_percent === 'number'
          ? { commission_bps: Math.round(values.commission_percent * 100) }
          : {}),
      });
      if (result.bounced_to_review) {
        message.info('在售商品改动后已自动重新提交审核');
      } else {
        message.success('商品已更新');
      }
      setEditOpen(false);
      refresh();
    } catch (error) {
      if ((error as { errorFields?: unknown })?.errorFields) return;
      message.error((error as Error)?.message || '更新失败');
    }
  };

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
          <Button type="link" size="small" onClick={() => openEdit(record)}>
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
              重新提交审核
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

      <Modal
        title="新增商品"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="商品类型"
            name="product_type"
            rules={[{ required: true, message: '请选择商品类型' }]}
            extra="类型创建后不可修改；实物以外的类型仍在开发中"
          >
            <Radio.Group>
              <Space wrap>
                {Object.entries(PRODUCT_TYPE).map(([value, label]) => (
                  <Radio
                    key={value}
                    value={value}
                    disabled={!OPEN_PRODUCT_TYPES.includes(value)}
                  >
                    {label}
                    {OPEN_PRODUCT_TYPES.includes(value) ? null : (
                      <Tag style={{ marginLeft: 6 }}>待开发</Tag>
                    )}
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            label="商品名称"
            name="name"
            rules={[{ required: true, message: '请输入商品名称' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            label="价格（元）"
            name="price"
            rules={[{ required: true, message: '请输入价格' }]}
          >
            <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            label="库存"
            name="stock"
            rules={[{ required: true, message: '请输入库存' }]}
          >
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="商品主图" name="main_image">
            <MediaField kind="image" title="选择商品主图" boxSize={96} />
          </Form.Item>
          <Form.Item label="商品视频（可选）" name="video_url">
            <MediaField kind="video" title="选择商品视频" boxSize={96} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑商品"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={handleEditSave}
        destroyOnHidden
        forceRender
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="商品名称"
            name="name"
            rules={[{ required: true, message: '请输入商品名称' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item label="商品详情">
            {/* 不是 Form 字段：富文本是重组件，单独状态更好控 */}
            <RichTextEditor
              value={richDesc}
              onChange={setRichDesc}
              placeholder="商品详情：成色、规格、配件、使用说明…（可插入图片、表格）"
              minHeight={260}
            />
          </Form.Item>
          <Form.Item label="商品主图" name="main_image">
            <MediaField kind="image" title="选择商品主图" boxSize={96} />
          </Form.Item>
          <Form.Item label="商品视频（可选）" name="video_url">
            <MediaField kind="video" title="选择商品视频" boxSize={96} />
          </Form.Item>
          <Form.Item
            label="价格（元）"
            name="price_yuan"
            rules={[{ required: true, message: '请输入价格' }]}
          >
            <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            label="库存"
            name="stock"
            rules={[{ required: true, message: '请输入库存' }]}
          >
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            label="佣金比例（%）"
            name="commission_percent"
            extra={
              editing?.commission_locked
                ? '已被运营调整并锁定，暂不可修改；有异议请联系运营'
                : '平台按这个比例从成交额里抽佣；留空则用分类默认比例（下限 1%）'
            }
          >
            <InputNumber
              min={1}
              max={100}
              step={0.5}
              style={{ width: '100%' }}
              disabled={Boolean(editing?.commission_locked)}
            />
          </Form.Item>
        </Form>
      </Modal>
    </SellerShell>
  );
}
