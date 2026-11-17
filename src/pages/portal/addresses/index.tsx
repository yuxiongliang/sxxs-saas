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

type FormValues = Omit<AddressRecord, 'id'>;

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
      province: '',
      city: '',
      district: '',
      detail: '',
      is_default: false,
    });
    setOpen(true);
  };

  const openEdit = (record: AddressRecord) => {
    setEditing(record);
    form.setFieldsValue({ ...record });
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editing) {
        await updateAddress(editing.id, values);
        message.success('地址已更新');
      } else {
        await createAddress(values);
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
      render: (_, record) =>
        `${record.province}${record.city}${record.district}${record.detail}`,
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
              这类脏数据，后面按地区统计和配送都受影响 */}
          <Form.Item
            label="省 / 市 / 区"
            required
            shouldUpdate={(prev, next) =>
              prev.province !== next.province ||
              prev.city !== next.city ||
              prev.district !== next.district
            }
          >
            {() => (
              <RegionCascader
                value={{
                  province: form.getFieldValue('province'),
                  city: form.getFieldValue('city'),
                  district: form.getFieldValue('district'),
                }}
                onChange={(picked) => {
                  form.setFieldsValue({
                    province: picked.province ?? '',
                    city: picked.city ?? '',
                    district: picked.district ?? '',
                  });
                }}
              />
            )}
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
