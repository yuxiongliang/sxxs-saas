import {
  LockOutlined,
  LogoutOutlined,
  MoonOutlined,
  SunOutlined,
  TranslationOutlined,
} from '@ant-design/icons';
import { useAppTheme } from '@shared';
import { getLocale, history, setLocale, useIntl } from '@umijs/max';
import { App, Dropdown, Form, Input, Modal, Space, Typography } from 'antd';
import { useState } from 'react';
import type { PlatformAuthUser } from '@/services/api';
import { changePlatformPassword, logout } from '@/services/api';
import { tokens } from '@/services/http';

export default function PlatformAvatar({ user }: { user?: PlatformAuthUser }) {
  const { setMode } = useAppTheme();
  const intl = useIntl();
  const { message } = App.useApp();
  const [pwOpen, setPwOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{
    old_password: string;
    new_password: string;
    confirm: string;
  }>();

  const items = [
    {
      key: 'light',
      icon: <SunOutlined />,
      label: intl.formatMessage({ id: 'theme.light' }),
    },
    {
      key: 'dark',
      icon: <MoonOutlined />,
      label: intl.formatMessage({ id: 'theme.dark' }),
    },
    {
      key: 'lang',
      icon: <TranslationOutlined />,
      label: getLocale() === 'zh-CN' ? 'English' : '中文',
    },
    { type: 'divider' as const },
    {
      key: 'password',
      icon: <LockOutlined />,
      label: '修改密码',
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: intl.formatMessage({ id: 'avatar.logout' }),
    },
  ];

  const clearAndLeave = () => {
    tokens.clear();
    history.push('/login');
  };

  const onClick = async ({ key }: { key: string }) => {
    if (key === 'light' || key === 'dark') {
      setMode(key);
      return;
    }
    if (key === 'lang') {
      setLocale(getLocale() === 'zh-CN' ? 'en-US' : 'zh-CN', false);
      return;
    }
    if (key === 'password') {
      form.resetFields();
      setPwOpen(true);
      return;
    }
    if (key === 'logout') {
      try {
        await logout();
      } catch {
        /* 退出失败也要清掉本地会话 */
      }
      clearAndLeave();
    }
  };

  const submitPassword = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await changePlatformPassword({
        old_password: values.old_password,
        new_password: values.new_password,
      });
      setPwOpen(false);
      message.success('密码已修改，请用新密码重新登录');
      // 后端已把 token_version +1，旧 token 全部失效 —— 主动清掉并回登录页
      clearAndLeave();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dropdown menu={{ items, onClick }}>
        <Space style={{ cursor: 'pointer' }}>
          <Typography.Text>
            {user?.nickname ?? user?.username ?? 'platform'}
          </Typography.Text>
        </Space>
      </Dropdown>

      <Modal
        open={pwOpen}
        title="修改密码"
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        onOk={submitPassword}
        onCancel={() => setPwOpen(false)}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          改完后所有已登录的会话立即失效，需要用新密码重新登录。
        </Typography.Paragraph>
        <Form form={form} layout="vertical">
          <Form.Item
            label="当前密码"
            name="old_password"
            rules={[{ required: true, message: '请输入当前密码' }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            label="新密码"
            name="new_password"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 8, max: 128, message: '密码 8-128 位' },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            label="确认新密码"
            name="confirm"
            dependencies={['new_password']}
            rules={[
              { required: true, message: '请再输入一次新密码' },
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
}
