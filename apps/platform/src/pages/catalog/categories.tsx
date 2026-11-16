import { ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import PageShell from '@/components/PageShell';
import {
  createProductCategory,
  deleteProductCategory,
  listProductCategories,
  type ProductCategoryRecord,
  updateProductCategory,
} from '@/services/api';

interface FormValues {
  name: string;
  slug: string;
  sort: number;
  status: 'active' | 'archived';
  /** 以百分比填写，提交时换算成万分比 */
  commission_percent: number;
}

const bpsToPercent = (bps: number) => bps / 100;

/**
 * 商品分类（平台级，全租户共用）。
 *
 * 这里设的 `default_commission_bps` 是**租户向卖家抽佣**的默认比例：
 * 卖家发布商品时选了这个分类，就按这个比例扣，卖家可以在自己商品上单独改；
 * 租户也可以改并把该商品锁住（卖家不能再改回去）。
 *
 * 注意：它与「租户分类」页的 `commission_bps`（平台向租户抽）完全是两回事。
 */
export default function ProductCategoriesPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ProductCategoryRecord>();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string>();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['platform-product-categories', keyword, status],
    queryFn: () =>
      listProductCategories({ keyword: keyword || undefined, status }),
  });

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ['platform-product-categories'],
    });

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        name: values.name,
        slug: values.slug,
        sort: values.sort ?? 0,
        status: values.status,
        default_commission_bps: Math.round(
          Number(values.commission_percent ?? 0) * 100,
        ),
      };
      return editing
        ? updateProductCategory(editing.id, payload)
        : createProductCategory(payload);
    },
    onSuccess: () => {
      message.success(editing ? '分类已更新' : '分类已创建');
      setOpen(false);
      setEditing(undefined);
      form.resetFields();
      refresh();
    },
    onError: (error: Error) => message.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteProductCategory(id),
    onSuccess: () => {
      message.success('分类已删除');
      refresh();
    },
    onError: (error: Error) => message.error(error.message),
  });

  const columns: ColumnsType<ProductCategoryRecord> = [
    { title: '分类名称', dataIndex: 'name', width: 180 },
    {
      title: '标识',
      dataIndex: 'slug',
      width: 150,
      render: (value: string) => (
        <Typography.Text code>{value}</Typography.Text>
      ),
    },
    {
      title: '默认抽佣',
      dataIndex: 'default_commission_bps',
      width: 120,
      render: (value: number) => (
        <Tag color="blue">{`${bpsToPercent(value)}%`}</Tag>
      ),
    },
    { title: '商品数', dataIndex: 'product_count', width: 90 },
    { title: '排序', dataIndex: 'sort', width: 80 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: string) =>
        value === 'active' ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>,
    },
    {
      title: '操作',
      width: 160,
      render: (_, record) => (
        <Space size={0}>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setEditing(record);
              form.setFieldsValue({
                name: record.name,
                slug: record.slug,
                sort: record.sort,
                status: record.status as 'active' | 'archived',
                commission_percent: bpsToPercent(record.default_commission_bps),
              });
              setOpen(true);
            }}
          >
            编辑
          </Button>
          <Popconfirm
            title={
              record.product_count
                ? `该分类下还有 ${record.product_count} 个商品，不能删除；建议改为停用`
                : '确定删除该分类？'
            }
            onConfirm={() => remove.mutate(record.id)}
            disabled={record.product_count > 0}
          >
            <Button
              type="link"
              size="small"
              danger
              disabled={record.product_count > 0}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <PageShell
      title="商品分类"
      subTitle="全平台共用的一套分类；分类默认抽佣比例 = 租户向卖家收取的默认佣金"
      extra={
        <Button
          type="primary"
          onClick={() => {
            setEditing(undefined);
            form.resetFields();
            form.setFieldsValue({
              sort: 0,
              status: 'active',
              commission_percent: 10,
            } as Partial<FormValues> as FormValues);
            setOpen(true);
          }}
        >
          新建分类
        </Button>
      }
    >
      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input.Search
            allowClear
            placeholder="搜分类名称 / 标识"
            style={{ width: 280 }}
            onSearch={(value) => setKeyword(value.trim())}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 120 }}
            value={status}
            onChange={setStatus}
            options={[
              { label: '启用', value: 'active' },
              { label: '停用', value: 'archived' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
            刷新
          </Button>
        </Space>
        <Table
          rowKey="id"
          loading={isLoading}
          columns={columns}
          dataSource={data ?? []}
          pagination={false}
        />
      </Card>

      <Modal
        title={editing ? '编辑分类' : '新建分类'}
        open={open}
        onCancel={() => {
          setOpen(false);
          setEditing(undefined);
        }}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
        destroyOnHidden
        forceRender
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => save.mutate(values)}
        >
          <Form.Item
            label="分类名称"
            name="name"
            rules={[{ required: true, message: '请输入分类名称' }]}
          >
            <Input placeholder="例如 数码" />
          </Form.Item>
          <Form.Item
            label="标识（slug）"
            name="slug"
            extra="小写字母/数字/连字符，全平台唯一；创建后请谨慎修改"
            rules={[
              { required: true, message: '请输入标识' },
              {
                pattern: /^[a-z0-9-]+$/,
                message: '只能用小写字母、数字、连字符',
              },
            ]}
          >
            <Input placeholder="digital" />
          </Form.Item>
          <Form.Item
            label="默认抽佣比例（%）"
            name="commission_percent"
            extra="卖家发布该分类商品时的默认值；卖家可改，租户也可覆盖并锁定"
          >
            <InputNumber
              min={0}
              max={100}
              step={0.5}
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Space size={16} style={{ display: 'flex' }}>
            <Form.Item label="排序" name="sort" style={{ flex: 1 }}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="状态" name="status" style={{ flex: 1 }}>
              <Select
                options={[
                  { label: '启用', value: 'active' },
                  { label: '停用', value: 'archived' },
                ]}
              />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </PageShell>
  );
}
