import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { history, useIntl, useModel } from '@umijs/max';
import { App, Button, Card, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { login } from '@/services/api';
import { tokens } from '@/services/http';

export default function PlatformLoginPage() {
  const intl = useIntl();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  // 登录后**必须**刷新全局 initialState：否则顶栏还停在登录前的空用户上，
  // 右上角会一直显示兜底文案「platform」，而不是真实昵称。
  const { refresh } = useModel('@@initialState');

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const session = await login(values.username, values.password);
      tokens.set(session.access_token);
      await refresh();
      const params = new URLSearchParams(window.location.search);
      history.replace(params.get('redirect') || '/tenants/list');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <Card style={{ width: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Typography.Title level={3} style={{ marginBottom: 4 }}>
            {intl.formatMessage({ id: 'login.title' })}
          </Typography.Title>
          <Typography.Text type="secondary">
            {intl.formatMessage({ id: 'login.subtitle' })}
          </Typography.Text>
        </div>
        <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item
            name="username"
            label={intl.formatMessage({ id: 'login.username' })}
            rules={[
              {
                required: true,
                message: intl.formatMessage({ id: 'login.usernameRequired' }),
              },
            ]}
          >
            <Input prefix={<UserOutlined />} autoComplete="username" />
          </Form.Item>
          <Form.Item
            name="password"
            label={intl.formatMessage({ id: 'login.password' })}
            rules={[
              {
                required: true,
                message: intl.formatMessage({ id: 'login.passwordRequired' }),
              },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              autoComplete="current-password"
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            {intl.formatMessage({ id: 'login.submit' })}
          </Button>
        </Form>
      </Card>
    </div>
  );
}
