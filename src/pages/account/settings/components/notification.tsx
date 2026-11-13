import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Card, Space, Switch, Table, Tag, Typography } from 'antd';
import React from 'react';
import {
  getNotificationPrefs,
  type NotificationCategorySetting,
  saveNotificationPref,
} from '@/services/auth/api';

const CHANNEL_LABEL: Record<string, string> = {
  sms: '短信',
  email: '邮件',
  inbox: '站内信',
};

/**
 * 新消息通知：按「分类 × 渠道」保存到后端，并在群发时真实生效。
 *
 * 站内信是强制渠道（欠费/安全/合规必须送达），只展示不可关 —— 与租户级
 * 渠道开关保持同一条约定。开关关掉后，`send_notification` 会把你从该分类
 * 该渠道的收件人里排除，记录里的 `skipped_count` 会 +1。
 */
const NotificationView: React.FC = () => {
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const prefs = useQuery({
    queryKey: ['account-notification-prefs'],
    queryFn: getNotificationPrefs,
  });

  const save = useMutation({
    mutationFn: saveNotificationPref,
    onSuccess: () => {
      message.success('通知设置已保存');
      queryClient.invalidateQueries({
        queryKey: ['account-notification-prefs'],
      });
    },
    onError: (error: Error) => message.error(error.message),
  });

  const categories = prefs.data?.categories ?? [];

  const channelEnabled = (
    record: NotificationCategorySetting,
    channel: string,
  ) =>
    record.channels.find((item) => item.channel === channel)?.enabled ?? true;

  const toggle = (
    record: NotificationCategorySetting,
    channel: string,
    enabled: boolean,
  ) => {
    save.mutate({ category: record.category, channel, enabled });
  };

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        title="这些开关会真的影响发送"
        description="关掉某个分类的短信或邮件后，运营发同类通知时你会被跳过（发送记录里的「跳过」人数会相应增加）。站内信承载欠费、安全与合规通知，不能关闭。"
      />

      <Table<NotificationCategorySetting>
        rowKey="category"
        size="small"
        loading={prefs.isLoading}
        dataSource={categories}
        pagination={false}
        columns={[
          {
            title: '通知分类',
            dataIndex: 'label',
            width: 180,
            render: (label: string, record) => (
              <Space orientation="vertical" size={0}>
                <Typography.Text strong>{label}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {record.category}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: '站内信',
            dataIndex: 'inbox',
            width: 120,
            render: () => (
              <Space size={6}>
                <Switch checked disabled size="small" />
                <Tag color="red">强制</Tag>
              </Space>
            ),
          },
          ...(['sms', 'email'] as const).map((channel) => ({
            title: CHANNEL_LABEL[channel],
            key: channel,
            width: 100,
            render: (_: unknown, record: NotificationCategorySetting) => (
              <Switch
                size="small"
                checked={channelEnabled(record, channel)}
                loading={save.isPending}
                onChange={(checked) => toggle(record, channel, checked)}
              />
            ),
          })),
        ]}
      />

      <Card size="small" title="当前联系方式">
        <Typography.Text>
          邮箱：
          {prefs.data?.contact.email ? (
            <Tag color="green">{prefs.data.contact.email}</Tag>
          ) : (
            <Tag>未绑定</Tag>
          )}
          手机号：
          {prefs.data?.contact.phone ? (
            <Tag color="green">{prefs.data.contact.phone}</Tag>
          ) : (
            <Tag>未绑定</Tag>
          )}
        </Typography.Text>
        <Typography.Paragraph
          type="secondary"
          style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}
        >
          收不到短信/邮件时，先到「账号绑定」确认联系方式是否有效。
        </Typography.Paragraph>
      </Card>
    </Space>
  );
};

export default NotificationView;
