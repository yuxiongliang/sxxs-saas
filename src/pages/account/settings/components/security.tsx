import { LockOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
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
import dayjs from 'dayjs';
import React, { useState } from 'react';
import { changePassword, logout, me } from '@/services/auth/api';
import { clearAccessToken } from '@/utils/authToken';

const formatTime = (value?: string | null) =>
  value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—';

type PasswordForm = {
  old_password: string;
  new_password: string;
  confirm_password: string;
};

/**
 * 安全设置：只放**真的能生效**的东西。
 *
 * - 修改密码：验当前密码 → 改 `password_hash` → 强制重新登录（旧 token 还能活 30 分钟，
 *   所以前端主动清掉，避免用户以为已经换号了）；
 * - 密保手机 / 备用邮箱：后端没有验证码通道，改绑走「账号绑定」+ 当前密码确认，
 *   这里只读展示状态；
 * - 密保问题 / MFA：数据库里没有对应字段，模板里那两条是死数据，已删除。
 */
const SecurityView: React.FC = () => {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<PasswordForm>();

  const { data, isError, error, refetch } = useQuery({
    queryKey: ['account-me'],
    queryFn: me,
  });
  const user = data?.user;

  const save = useMutation({
    mutationFn: changePassword,
    onSuccess: async () => {
      setOpen(false);
      form.resetFields();
      // 改密码会让 token_version +1，服务端已经把本人所有会话作废。
      // 这里只负责清掉本地痕迹并回登录页；清不掉 refresh cookie 就明确告知。
      let loggedOut = true;
      try {
        await logout();
      } catch {
        loggedOut = false;
      }
      clearAccessToken();
      if (loggedOut) {
        message.success('密码已修改，请用新密码重新登录');
        window.setTimeout(() => {
          window.location.replace('/user/login');
        }, 800);
      } else {
        message.warning(
          '密码已修改；但当前浏览器会话未能安全终止，请手动退出登录后再用新密码登录',
        );
      }
    },
    onError: (error: Error) => message.error(error.message),
  });

  const handleOk = async () => {
    const values = await form.validateFields();
    save.mutate({
      old_password: values.old_password,
      new_password: values.new_password,
    });
  };

  const rows = [
    {
      title: '账户密码',
      description: user?.has_password ? (
        <>
          已设置登录密码。修改后需要用新密码重新登录。
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            （规范：至少 8 位）
          </Typography.Text>
        </>
      ) : (
        '该账号还没有设置密码（由管理员创建），请联系管理员重置。'
      ),
      actions: user?.has_password
        ? [
            <Button
              key="password"
              type="link"
              icon={<LockOutlined />}
              onClick={() => setOpen(true)}
            >
              修改密码
            </Button>,
          ]
        : [],
    },
    {
      title: '绑定手机号',
      description: user?.phone
        ? `已绑定：${user.phone} —— 更换请到「账号绑定」，需要输入当前密码确认`
        : '未绑定手机号。绑定后可用于身份核对（当前无短信验证码通道，改绑需输入当前密码）',
      actions: [],
    },
    {
      title: '登录邮箱',
      description: `当前邮箱：${user?.email ?? '—'}（登录凭据之一，更换请到「账号绑定」）`,
      actions: [],
    },
    {
      title: '登录记录',
      description: (
        <>
          上次登录：{formatTime(user?.previous_login_at)}
          <br />
          本次登录：{formatTime(user?.last_login_at)}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            （发现不是你本人操作？立即改密码，旧会话会全部失效）
          </Typography.Text>
        </>
      ),
      actions: [],
    },
  ];

  if (isError) {
    return (
      <Alert
        type="error"
        showIcon
        title="安全设置加载失败"
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
        {rows.map((item, index) => (
          <div key={item.title}>
            {index > 0 ? <Divider style={{ margin: '12px 0' }} /> : null}
            <Flex justify="space-between" align="center" gap={16}>
              <div>
                <div style={{ fontWeight: 600 }}>{item.title}</div>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  {item.description}
                </Typography.Text>
              </div>
              <div>{item.actions}</div>
            </Flex>
          </div>
        ))}
      </Flex>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        <Tag color="orange">未实现</Tag>
        密保问题与 MFA 二次验证当前后端没有对应字段与校验，已从列表中移除，
        不会再出现「点了没反应」的入口。
      </Typography.Text>

      <Modal
        title="修改登录密码"
        open={open}
        onCancel={() => {
          setOpen(false);
          form.resetFields();
        }}
        onOk={handleOk}
        confirmLoading={save.isPending}
        okText="确认修改"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="old_password"
            label="当前密码"
            rules={[{ required: true, message: '请输入当前密码' }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            name="new_password"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 8, message: '至少 8 位' },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirm_password"
            label="确认新密码"
            dependencies={['new_password']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('new_password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的新密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default SecurityView;
