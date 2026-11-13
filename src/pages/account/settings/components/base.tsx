import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Form,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import React from 'react';
import { me, updateProfile } from '@/services/auth/api';

const GENDER_OPTIONS = [
  { label: '男', value: 'male' },
  { label: '女', value: 'female' },
  { label: '其他', value: 'other' },
  { label: '不便透露', value: 'unknown' },
];

const GENDER_LABEL: Record<string, string> = {
  male: '男',
  female: '女',
  other: '其他',
  unknown: '不便透露',
};

const formatTime = (value?: string | null) =>
  value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—';

/**
 * 基本设置：身份只读展示 + 可改资料实际保存。
 *
 * 这里的字段全部对应 `users` 表真实存在的列。
 * 模板自带的「昵称、个人简介、国家/地区、省市、街道地址、联系电话、头像上传」
 * 都已在后端没有落点（改了不生效），因此整块删除 —— 账号身份看上面的
 * 「用户ID / 用户名」，联系方式去「账号绑定」换。
 */
const BaseView: React.FC = () => {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({
    queryKey: ['account-me'],
    queryFn: me,
  });
  const user = data?.user;

  const save = useMutation({
    mutationFn: (input: { gender?: string | null; birthday?: string | null }) =>
      updateProfile(input),
    onSuccess: () => {
      message.success('个人资料已更新');
      queryClient.invalidateQueries({ queryKey: ['account-me'] });
    },
    onError: (error: Error) => message.error(error.message),
  });

  const handleFinish = (values: {
    gender?: string;
    birthday?: dayjs.Dayjs | null;
  }) => {
    save.mutate({
      gender: values.gender ?? null,
      birthday: values.birthday ? values.birthday.format('YYYY-MM-DD') : null,
    });
  };

  if (isLoading || !user) {
    return <Card loading size="small" />;
  }

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Card
        size="small"
        title="账号身份"
        extra={<Tag color="blue">不可自行修改</Tag>}
      >
        <Descriptions column={1} size="small" colon={false}>
          <Descriptions.Item label="用户ID">
            <Space size={8}>
              <Typography.Text code copyable={{ text: user.public_id }}>
                {user.public_id}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                报障 / 对账时报这个编号
              </Typography.Text>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="用户名">
            <Typography.Text strong>{user.username}</Typography.Text>
            <Typography.Text
              type="secondary"
              style={{ fontSize: 12, marginLeft: 8 }}
            >
              登录名
            </Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="邮箱">
            {user.email || '未绑定'}
          </Descriptions.Item>
          <Descriptions.Item label="手机号">
            {user.phone || '未绑定'}
          </Descriptions.Item>
          <Descriptions.Item label="最近登录">
            {formatTime(user.last_login_at)}
          </Descriptions.Item>
        </Descriptions>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          用户名与用户ID是账号身份，不能自行修改；邮箱与手机号在「账号绑定」里更换；
          昵称由管理员在「用户管理」维护。需要改用户名请联系平台管理员。
        </Typography.Text>
      </Card>

      <Card size="small" title="个人资料">
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            gender: user.gender ?? undefined,
            birthday: user.birthday ? dayjs(user.birthday) : undefined,
          }}
          onFinish={handleFinish}
          requiredMark={false}
        >
          <Form.Item name="gender" label="性别">
            <Select
              allowClear
              style={{ maxWidth: 240 }}
              placeholder="请选择"
              options={GENDER_OPTIONS}
            />
          </Form.Item>
          <Form.Item
            name="birthday"
            label="生日"
            extra="生日用于提醒与资料统计，可留空。"
          >
            <DatePicker
              style={{ maxWidth: 240, width: '100%' }}
              format="YYYY-MM-DD"
              disabledDate={(current) =>
                current && current > dayjs().endOf('day')
              }
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={save.isPending}>
            保存个人资料
          </Button>
        </Form>
        <Typography.Paragraph
          type="secondary"
          style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}
        >
          当前性别：{user.gender ? GENDER_LABEL[user.gender] : '未填写'}；
          当前生日：{user.birthday ?? '未填写'}。
        </Typography.Paragraph>
      </Card>
    </Space>
  );
};

export default BaseView;
