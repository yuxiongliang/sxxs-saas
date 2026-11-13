import { MailOutlined, MobileOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Divider,
  Flex,
  Form,
  Input,
  Modal,
  Tag,
  Typography,
} from 'antd';
import React, { useState } from 'react';
import { me, updateContact } from '@/services/auth/api';

type BindingKind = 'phone' | 'email';

type BindingForm = { value: string; password: string };

/**
 * 账号绑定：手机号与邮箱是**真实存在**的两种绑定。
 *
 * 模板里的「淘宝 / 支付宝 / 钉钉」后端没有任何 OAuth 实体，点了一定没反应，已删除。
 * 换绑需要当前密码确认 —— 项目没有短信/邮件验证码通道（`services/setting.py` 的
 * 「测试连接」也是演示态），密码是当下唯一能证明「是本人」的手段。
 */
const BindingView: React.FC = () => {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<BindingKind | null>(null);
  const [form] = Form.useForm<BindingForm>();

  const { data, isError, error, refetch } = useQuery({
    queryKey: ['account-me'],
    queryFn: me,
  });
  const user = data?.user;

  const save = useMutation({
    mutationFn: (input: {
      kind: BindingKind;
      value: string;
      password: string;
    }) =>
      updateContact(
        input.kind === 'phone'
          ? { phone: input.value, password: input.password }
          : { email: input.value, password: input.password },
      ),
    onSuccess: () => {
      message.success(kind === 'phone' ? '手机号已更新' : '邮箱已更新');
      queryClient.invalidateQueries({ queryKey: ['account-me'] });
      queryClient.invalidateQueries({
        queryKey: ['account-notification-prefs'],
      });
      setKind(null);
      form.resetFields();
    },
    onError: (error: Error) => message.error(error.message),
  });

  const handleOk = async () => {
    if (!kind) return;
    const values = await form.validateFields();
    save.mutate({ kind, value: values.value, password: values.password });
  };

  const rows = [
    {
      key: 'phone' as BindingKind,
      icon: <MobileOutlined style={{ fontSize: 22 }} />,
      title: '手机号',
      bound: Boolean(user?.phone),
      value: user?.phone,
      description: user?.phone
        ? `已绑定：${user.phone}`
        : '未绑定。绑定后可用于身份核对与紧急联系（当前渠道无短信验证码，改绑需密码确认）。',
    },
    {
      key: 'email' as BindingKind,
      icon: <MailOutlined style={{ fontSize: 22 }} />,
      title: '邮箱',
      bound: Boolean(user?.email),
      value: user?.email,
      description: user?.email
        ? `已绑定：${user.email}（改掉后用新邮箱登录）`
        : '未绑定邮箱。',
    },
  ];

  if (isError) {
    return (
      <Alert
        type="error"
        showIcon
        title="绑定信息加载失败"
        description={String((error as Error)?.message ?? '未知错误')}
        action={
          <Button size="small" onClick={() => refetch()}>
            重试
          </Button>
        }
      />
    );
  }

  return (
    <>
      <Flex vertical>
        {' '}
        {rows.map((item, index) => (
          <div key={item.key}>
            {index > 0 ? <Divider style={{ margin: '12px 0' }} /> : null}
            <Flex justify="space-between" align="center" gap={16}>
              <Flex gap={12} align="center">
                <span style={{ color: '#1677ff' }}>{item.icon}</span>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {item.title}{' '}
                    {item.bound ? (
                      <Tag color="green">已绑定</Tag>
                    ) : (
                      <Tag>未绑定</Tag>
                    )}
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    {item.description}
                  </Typography.Text>
                </div>
              </Flex>
              <Button
                type="link"
                onClick={() => {
                  setKind(item.key);
                  form.setFieldsValue({
                    value: item.value ?? '',
                    password: '',
                  });
                }}
              >
                {item.bound ? '更换' : '绑定'}
              </Button>
            </Flex>
          </div>
        ))}
      </Flex>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        只支持手机号与邮箱两种绑定。第三方账号（淘宝 / 支付宝 / 钉钉）需要 OAuth
        接入，后端尚未实现，因此不再展示无法使用的入口。
      </Typography.Text>

      <Modal
        title={kind === 'phone' ? '更换手机号' : '更换邮箱'}
        open={kind !== null}
        onCancel={() => {
          setKind(null);
          form.resetFields();
        }}
        onOk={handleOk}
        confirmLoading={save.isPending}
        okText="保存"
        destroyOnHidden
        forceRender
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="value"
            label={kind === 'phone' ? '新手机号' : '新邮箱'}
            rules={[
              { required: true, message: '请输入新值' },
              ...(kind === 'email'
                ? [{ type: 'email' as const, message: '请输入合法邮箱' }]
                : []),
            ]}
          >
            <Input
              placeholder={
                kind === 'phone' ? '13800000000' : 'name@example.com'
              }
            />
          </Form.Item>
          <Form.Item
            name="password"
            label="当前密码"
            extra="改绑属于敏感操作，需要验证是你本人。"
            rules={[{ required: true, message: '请输入当前密码' }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default BindingView;
