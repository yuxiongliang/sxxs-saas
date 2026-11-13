import { PictureOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useModel } from '@umijs/max';
import {
  App,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Space,
  Spin,
  Typography,
} from 'antd';
import React, { useState } from 'react';
import AttachmentPicker from '@/components/AttachmentPicker';
import SettingPage from '@/pages/system/components/SettingPage';
import { applyBrandFavicon } from '@/services/publicBrand';
import { getTenantBrand, saveTenantBrand } from '@/services/system/api';
import type { AttachmentRecord } from '@/services/system/types';

interface FormValues {
  display_name: string;
  logo_url: string;
  favicon_url: string;
}

/** 与后端 `api/v1/tenant_brand.py` 的 PUBLIC_ATTACHMENT_PREFIX 保持一致 */
const PUBLIC_ATTACHMENT_PREFIX = '/api/v1/attachments/public/';

/**
 * Logo 字段：点按钮弹附件中心，选图即用。
 *
 * 存的是 `/api/v1/attachments/public/{id}` 这种**相对**直链，而不是附件表里的绝对
 * url —— 绝对 url 指向后端 public_base_url，租户换了自己的域名就会打错站。
 * 保存时后端会把选中的附件标成 public，否则这个直链取不到图。
 *
 * 刚选完还没保存时，`/public/{id}` 仍是 404（附件还是 tenant 可见），
 * 所以预览临时用附件本身的 `url`，保存后自动换成稳定直链。
 */
const LogoField: React.FC<{
  value?: string;
  onChange?: (value: string) => void;
}> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [freshPreview, setFreshPreview] = useState<string>();
  const preview = freshPreview ?? value;

  return (
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      <Flex align="center" gap={16}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="点击选择图片"
          style={{
            width: 96,
            height: 96,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            padding: 0,
            border: '1px dashed #d9d9d9',
            borderRadius: 8,
            background: '#fafafa',
            cursor: 'pointer',
          }}
        >
          {preview ? (
            <img
              src={preview}
              alt="站点 logo"
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
          <Button icon={<PictureOutlined />} onClick={() => setOpen(true)}>
            {value ? '更换图片' : '从附件中心选择'}
          </Button>
          {value ? (
            <Button
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
      </Flex>
      {value ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          已选：{value}
        </Typography.Text>
      ) : null}
      <AttachmentPicker
        open={open}
        title="选择站点 Logo"
        onCancel={() => setOpen(false)}
        onSelect={(record: AttachmentRecord) => {
          setFreshPreview(record.url);
          onChange?.(`${PUBLIC_ATTACHMENT_PREFIX}${record.id}`);
        }}
      />
    </Space>
  );
};

export default function TenantBrandPage() {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const queryClient = useQueryClient();
  const { setInitialState } = useModel('@@initialState');

  const brand = useQuery({
    queryKey: ['tenant-brand'],
    queryFn: getTenantBrand,
  });

  const save = useMutation({
    mutationFn: (values: FormValues) => saveTenantBrand(values),
    onSuccess: (saved, values) => {
      message.success('品牌已保存，控制台头部与买家商城已同步');
      queryClient.invalidateQueries({ queryKey: ['tenant-brand'] });
      // 头部 logo / 标题来自 initialState.brand（见 app.tsx 的 layout()）。
      // 不写回去的话，用户得手动刷新才能看到「保存后显示」。
      setInitialState((state) => ({
        ...state,
        brand: {
          slug: saved.slug,
          name: saved.name,
          display_name: saved.display_name,
          logo_url: saved.logo_url,
          favicon_url: saved.favicon_url,
        },
      }));
      applyBrandFavicon(values.favicon_url);
    },
    onError: (error: Error) => message.error(error.message),
  });

  if (brand.isLoading || !brand.data) return <Spin />;

  const current = brand.data;

  return (
    <SettingPage
      title="站点品牌"
      subTitle="买家与控制台看到的站点名称与 Logo；通知模板里的 {{tenant_name}} 也取这里"
      icon={<PictureOutlined />}
    >
      <Card>
        <Form
          form={form}
          layout="vertical"
          style={{ maxWidth: 640 }}
          initialValues={{
            display_name: current.display_name,
            logo_url: current.logo_url ?? '',
            favicon_url: current.favicon_url ?? '',
          }}
          onFinish={(values) => save.mutate(values)}
        >
          <Form.Item
            name="display_name"
            label="全站名称"
            extra="为空时回落到租户名称，不会显示空白"
          >
            <Input placeholder="例如 李思的二手好物" allowClear />
          </Form.Item>

          <Form.Item
            name="logo_url"
            label="站点 Logo"
            extra="从附件中心选图；保存后控制台左上角与买家商城顶部都会换成它"
          >
            <LogoField />
          </Form.Item>

          <Form.Item
            name="favicon_url"
            label="浏览器图标（Favicon）"
            extra="填 .ico / .png 图片地址；留空用默认图标"
          >
            <Input
              placeholder="https://... 或 /api/v1/attachments/public/12"
              allowClear
            />
          </Form.Item>

          <Button type="primary" htmlType="submit" loading={save.isPending}>
            保存
          </Button>
        </Form>
      </Card>
    </SettingPage>
  );
}
