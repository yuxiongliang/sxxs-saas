import { ShopOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Form, Input, Space, Spin } from 'antd';
import { useEffect, useState } from 'react';
import { getSellerProfile, updateSellerShop } from '@/services/commerce/api';
import SellerShell from '../components/SellerShell';

/**
 * 卖家中心 · 店铺管理。
 *
 * 这里原来是散在「店铺概览」里的一块自提设置 —— 概览是**看数据**的地方，
 * 塞表单会让人分不清「我在配置还是在看报表」。现在配置统一收到这一页：
 *
 * 1. 店铺信息（店铺名、简介）：买家在看店铺时能看到的名字与介绍；
 * 2. **自提门店**（原「自提点」）：商品挂了「自提」时，买家结算页显示去哪儿取、几点取。
 *
 * 两者都走同一个 `PUT /portal/seller/shop`，所以做成**一张表单、一个保存按钮**，
 * 避免"改了两处只保存了一半"。
 */
export default function SellerShopPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<{
    name?: string;
    description?: string;
    address?: string;
    pickup_note?: string;
  }>();
  const [saving, setSaving] = useState(false);
  const [address, setAddress] = useState('');

  const profile = useQuery({
    queryKey: ['seller-profile'],
    queryFn: getSellerProfile,
  });

  const shop = profile.data?.shop;
  useEffect(() => {
    if (!shop) return;
    form.setFieldsValue({
      name: shop.name ?? '',
      description: shop.description ?? '',
      address: shop.address ?? '',
      pickup_note: shop.pickup_note ?? '',
    });
    setAddress(shop.address ?? '');
  }, [form, shop]);

  /** 重置 = 回到**已保存**的值。`form.resetFields()` 没有 initialValues，会把表单清空。 */
  const handleReset = () => {
    if (!shop) return;
    form.setFieldsValue({
      name: shop.name ?? '',
      description: shop.description ?? '',
      address: shop.address ?? '',
      pickup_note: shop.pickup_note ?? '',
    });
    setAddress(shop.address ?? '');
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await updateSellerShop({
        name: values.name ?? '',
        description: values.description ?? '',
        address: values.address ?? '',
        pickup_note: values.pickup_note ?? '',
      });
      message.success('店铺信息已保存');
      await queryClient.invalidateQueries({ queryKey: ['seller-profile'] });
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SellerShell title="店铺管理">
      <Spin spinning={profile.isLoading}>
        <Form form={form} layout="vertical" data-testid="seller-shop-page">
          <Card
            title={
              <Space size={6}>
                <ShopOutlined />
                店铺信息
              </Space>
            }
            style={{ marginBottom: 16 }}
          >
            <Form.Item
              label="店铺名"
              name="name"
              rules={[{ min: 2, max: 32, message: '店铺名 2-32 个字' }]}
            >
              <Input placeholder="买家在商品详情/店铺卡里看到的名字" />
            </Form.Item>
            <Form.Item label="店铺简介" name="description">
              <Input.TextArea
                rows={3}
                maxLength={200}
                showCount
                placeholder="一两句介绍：主营什么、发货时效、售后说明"
              />
            </Form.Item>
          </Card>

          {/* 自提门店：选「自提」的商品结算时，买家要看到去哪儿取、什么时间取 */}
          <Card
            title="自提门店"
            style={{ marginBottom: 16 }}
            data-testid="seller-pickup-card"
          >
            {address.trim() ? null : (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message="还没填自提地址"
                description="商品勾了「自提」时，买家结算只能看到「卖家未填写」，等于不能自提。"
              />
            )}
            <Form.Item
              label="自提地址"
              name="address"
              tooltip="买家选了自提时看到的就是这个地址"
            >
              <Input
                placeholder="如：深圳市南山区科技园 1 号 A 座 101"
                onChange={(event) => setAddress(event.target.value)}
              />
            </Form.Item>
            <Form.Item label="自提说明" name="pickup_note">
              <Input placeholder="如：工作日 10:00-18:00，请出示订单号" />
            </Form.Item>
          </Card>

          <Space>
            <Button
              type="primary"
              loading={saving}
              onClick={handleSave}
              data-testid="seller-shop-save"
            >
              保存
            </Button>
            <Button onClick={handleReset}>重置</Button>
          </Space>
        </Form>
      </Spin>
    </SellerShell>
  );
}
