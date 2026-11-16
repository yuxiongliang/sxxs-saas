import { PictureOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useModel } from '@umijs/max';
import { App, Button, Card, Divider, Form, Input, Spin } from 'antd';
import React from 'react';
import MediaField from '@/components/MediaField';
import SettingPage from '@/pages/system/components/SettingPage';
import {
  applyBrandDescription,
  applyBrandFavicon,
} from '@/services/publicBrand';
import { getTenantBrand, saveTenantBrand } from '@/services/system/api';

interface FormValues {
  display_name: string;
  site_description: string;
  logo_url: string;
  favicon_url: string;
  icp_number: string;
  icp_license: string;
}
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
      // 头部 logo / 标题 / 页脚备案信息都来自 initialState.brand。
      // 不写回去的话，用户得手动刷新才能看到「保存后显示」。
      setInitialState((state) => ({
        ...state,
        brand: {
          slug: saved.slug,
          name: saved.name,
          display_name: saved.display_name,
          site_description: saved.site_description ?? null,
          logo_url: saved.logo_url,
          favicon_url: saved.favicon_url,
          icp_number: saved.icp_number,
          icp_license: saved.icp_license,
        },
      }));
      applyBrandFavicon(values.favicon_url);
      // meta description 也要跟着改，不然保存后分享卡片还是旧介绍
      applyBrandDescription(saved.site_description);
    },
    onError: (error: Error) => message.error(error.message),
  });

  if (brand.isLoading || !brand.data) return <Spin />;

  const current = brand.data;

  return (
    <SettingPage
      title="站点品牌"
      subTitle="买家与控制台看到的站点名称、Logo 与页脚备案信息；通知模板里的 {{tenant_name}} 也取这里"
      icon={<PictureOutlined />}
    >
      <Card>
        <Form
          form={form}
          layout="vertical"
          style={{ maxWidth: 640 }}
          initialValues={{
            display_name: current.display_name,
            site_description: current.site_description ?? '',
            logo_url: current.logo_url ?? '',
            favicon_url: current.favicon_url ?? '',
            icp_number: current.icp_number ?? '',
            icp_license: current.icp_license ?? '',
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
            name="site_description"
            label="站点描述"
            extra="一句话介绍这个站点。会用在登录页副标题、页脚和买家商城顶部，也写进页面 meta description（搜索引擎/分享卡片）。留空则不显示"
          >
            <Input.TextArea
              rows={3}
              maxLength={300}
              showCount
              allowClear
              placeholder="例如 同城闲置交易平台：二手好物、当面验货、放心买"
            />
          </Form.Item>

          <Form.Item
            name="logo_url"
            label="站点 Logo"
            extra="从附件中心选图；设了 logo 后控制台头部只显示 logo（占掉标题位），买家商城顶部同样换图"
          >
            <MediaField kind="image" title="选择站点 Logo" boxSize={96} />
          </Form.Item>

          <Form.Item
            name="favicon_url"
            label="浏览器图标（Favicon）"
            extra="浏览器标签页上的小图标，建议用 32×32 或 64×64 的方图"
          >
            <MediaField kind="image" title="选择浏览器图标" boxSize={48} />
          </Form.Item>

          <Divider titlePlacement="start" plain>
            页脚备案信息
          </Divider>

          <Form.Item
            name="icp_number"
            label="ICP 备案号"
            extra="例如 京ICP备12345678号；留空则页脚不显示这一项（会自动链接到工信部备案系统）"
          >
            <Input placeholder="京ICP备12345678号" allowClear />
          </Form.Item>

          <Form.Item
            name="icp_license"
            label="ICP 许可证号"
            extra="例如 京ICP证030173号；留空则不显示"
          >
            <Input placeholder="京ICP证030173号" allowClear />
          </Form.Item>

          <Button type="primary" htmlType="submit" loading={save.isPending}>
            保存
          </Button>
        </Form>
      </Card>
    </SettingPage>
  );
}
