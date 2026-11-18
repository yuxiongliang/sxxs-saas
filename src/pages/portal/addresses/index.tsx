import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useState } from 'react';
import RegionCascader from '@/components/RegionCascader';
import {
  createAddress,
  deleteAddress,
  listAddresses,
  setDefaultAddress,
  updateAddress,
} from '@/services/commerce/api';
import type { AddressRecord } from '@/services/commerce/types';
import PortalShell from '../components/PortalShell';

/**
 * 表单里省市区是一个**级联数组** `region`，落库时才拆成三个裸名称字段。
 * 别退回"三个隐藏字段 + setFieldsValue"：未注册的字段 validateFields() 取不到。
 */
type FormValues = Omit<
  AddressRecord,
  'id' | 'province' | 'city' | 'district'
> & {
  region: string[];
};

const AddressesPage: React.FC = () => {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AddressRecord>();
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<FormValues>();

  const { data, isLoading } = useQuery({
    queryKey: ['portal-addresses'],
    queryFn: listAddresses,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['portal-addresses'] });

  const openCreate = () => {
    setEditing(undefined);
    form.resetFields();
    form.setFieldsValue({
      receiver_name: '',
      receiver_phone: '',
      region: [],
      detail: '',
      is_default: false,
    });
    setOpen(true);
  };

  const openEdit = (record: AddressRecord) => {
    setEditing(record);
    form.setFieldsValue({
      ...record,
      // 级联控件吃数组；历史地址里省市区是三个裸名称
      region: [record.province, record.city, record.district].filter(Boolean),
    });
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    // 级联控件给数组，落库仍是三个裸名称字段（与历史数据、其它接口一致）
    const [province = '', city = '', district = ''] = values.region ?? [];
    const payload = {
      receiver_name: values.receiver_name,
      receiver_phone: values.receiver_phone,
      province,
      city,
      district,
      detail: values.detail,
      is_default: values.is_default ?? false,
    };
    setSaving(true);
    try {
      if (editing) {
        const saved = await updateAddress(editing.id, payload);
        // 保存后核对一次：省市区没落库就不算成功（这类"静默无效"最难发现）
        if (
          saved.province !== province ||
          saved.city !== city ||
          saved.district !== district
        ) {
          message.error('保存后省市区没有生效，请重试或联系管理员');
          await refresh();
          return;
        }
        message.success('地址已更新');
      } else {
        await createAddress(payload);
        message.success('地址已保存');
      }
      setOpen(false);
      await refresh();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnsType<AddressRecord> = [
    {
      title: '收货人',
      key: 'receiver',
      render: (_, record) => (
        <Space orientation="vertical" size={2}>
          <Space size={8}>
            <Typography.Text strong>{record.receiver_name}</Typography.Text>
            {record.is_default ? <Tag color="blue">默认</Tag> : null}
          </Space>
          <Typography.Text type="secondary">
            {record.receiver_phone}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '地址',
      key: 'detail',
      render: (_, record) => {
        const region = `${record.province}${record.city}${record.district}`;
        return (
          <>
            {region ? (
              region
            ) : (
              <Typography.Text type="danger">未设置省市区</Typography.Text>
            )}
            {record.detail}
          </>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 260,
      render: (_, record) => (
        <Space size={4}>
          <Button type="link" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button
            type="link"
            disabled={record.is_default}
            onClick={async () => {
              await setDefaultAddress(record.id);
              message.success('已设为默认地址');
              await refresh();
            }}
          >
            设为默认
          </Button>
          <Popconfirm
            title="删除该地址？"
            onConfirm={async () => {
              await deleteAddress(record.id);
              message.success('已删除');
              await refresh();
            }}
          >
            <Button type="link" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <PortalShell title="收货地址">
      <Card
        title="我的收货地址"
        extra={
          <Button type="primary" onClick={openCreate}>
            新增地址
          </Button>
        }
      >
        {!isLoading && !data?.length ? (
          <Empty description="还没有收货地址">
            <Button type="primary" onClick={openCreate}>
              新增地址
            </Button>
          </Empty>
        ) : (
          <Table
            rowKey="id"
            loading={isLoading}
            columns={columns}
            dataSource={data ?? []}
            pagination={false}
          />
        )}
      </Card>

      <Modal
        title={editing ? '编辑地址' : '新增地址'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={saving}
        okText="保存"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="收货人"
            name="receiver_name"
            rules={[{ required: true, message: '请输入收货人' }]}
          >
            <Input placeholder="收货人姓名" />
          </Form.Item>
          <Form.Item
            label="联系电话"
            name="receiver_phone"
            rules={[{ required: true, message: '请输入联系电话' }]}
          >
            <Input placeholder="手机号" />
          </Form.Item>
          {/* 省市区必须从内置行政区划里选：手填会出现"广东/广东省""深圳/深圳市"
              这类脏数据，后面按地区统计和配送都受影响。
              **必须注册成 Form.Item 的字段**：之前用三个未注册的隐藏字段 +
              setFieldsValue，validateFields() 拿不到它们，保存下来就是空的。 */}
          <Form.Item
            label="省 / 市 / 区"
            name="region"
            rules={[{ required: true, message: '请选择省 / 市 / 区' }]}
          >
            <RegionCascader />
          </Form.Item>
          <Form.Item
            label="详细地址"
            name="detail"
            rules={[{ required: true, message: '请输入详细地址' }]}
          >
            <Input.TextArea rows={2} placeholder="街道、门牌号" />
          </Form.Item>
          <Form.Item
            label="设为默认地址"
            name="is_default"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </PortalShell>
  );
};

export default AddressesPage;
