import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  InputNumber,
  Select,
  Space,
  Table,
} from 'antd';
import { useEffect, useState } from 'react';
import PageShell from '@/components/PageShell';
import { getPlatformSetting, savePlatformSetting } from '@/services/api';

/**
 * 上传限制：**角色 × 文件类型** 的体积上限与允许格式。
 *
 * 这是全平台统一策略：租户运营、卖家、买家三个身份各自一套，后端
 * `services/attachment.save_upload` 按 `primary_role` 选中对应一档执行。
 * 格式留空 = 不限格式（体积仍然受限）。
 */
type Rule = { max_mb: number; formats: string[] };
type Policy = Record<string, Record<string, Rule>>;

const CATEGORY = 'upload';

const ROLES: Array<{ key: string; label: string; hint: string }> = [
  { key: 'tenant', label: '租户（控制台）', hint: '租户管理员/运营上传的素材' },
  { key: 'seller', label: '卖家', hint: '卖家中心上传的商品图与视频' },
  { key: 'buyer', label: '买家', hint: 'C 端买家的头像、评价图等' },
];

const TYPES: Array<{ key: string; label: string }> = [
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'document', label: '文档' },
  { key: 'other', label: '其他' },
];

const FALLBACK: Policy = {
  tenant: {
    image: {
      max_mb: 10,
      formats: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'],
    },
    video: { max_mb: 200, formats: ['mp4', 'webm', 'mov'] },
    document: {
      max_mb: 50,
      formats: [
        'pdf',
        'doc',
        'docx',
        'xls',
        'xlsx',
        'csv',
        'txt',
        'md',
        'json',
      ],
    },
    other: { max_mb: 20, formats: [] },
  },
};

const clonePolicy = (source: Policy): Policy =>
  Object.fromEntries(
    Object.entries(source).map(([role, types]) => [
      role,
      Object.fromEntries(
        Object.entries(types).map(([type, rule]) => [
          type,
          { max_mb: rule.max_mb, formats: [...rule.formats] },
        ]),
      ),
    ]),
  );

export default function UploadSettingsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [policy, setPolicy] = useState<Policy>(FALLBACK);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-setting', CATEGORY],
    queryFn: () => getPlatformSetting(CATEGORY),
  });

  useEffect(() => {
    const config = (data?.config ?? {}) as Policy;
    if (config && Object.keys(config).length) {
      setPolicy({
        ...clonePolicy(FALLBACK),
        ...clonePolicy(config as Policy),
      });
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      savePlatformSetting(CATEGORY, { enabled: true, config: policy }),
    onSuccess: () => {
      message.success('上传限制已保存，立即对所有新上传生效');
      queryClient.invalidateQueries({
        queryKey: ['platform-setting', CATEGORY],
      });
    },
    onError: (error: Error) => message.error(error.message),
  });

  const patch = (role: string, type: string, next: Partial<Rule>) => {
    setPolicy((prev) => ({
      ...prev,
      [role]: {
        ...prev[role],
        [type]: { ...prev[role][type], ...next },
      },
    }));
  };

  return (
    <PageShell
      title="上传限制"
      subTitle="全平台统一：租户 / 卖家 / 买家上传的各类附件，体积与格式都在这里管"
      extra={
        <Button
          type="primary"
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          保存
        </Button>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title="格式留空表示不限格式"
        description="体积上限始终生效。改动只影响之后的新上传，已上传的附件不受影响；后端是唯一执行点，前端仅做提示。"
      />
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        {ROLES.map((role) => (
          <Card
            key={role.key}
            size="small"
            title={role.label}
            extra={role.hint}
          >
            <Table
              rowKey="key"
              size="small"
              loading={isLoading}
              pagination={false}
              dataSource={TYPES.map((type) => ({
                ...type,
                rule: policy[role.key]?.[type.key],
              }))}
              columns={[
                { title: '类型', dataIndex: 'label', width: 100 },
                {
                  title: '最大体积（MB）',
                  width: 180,
                  render: (_, row) => (
                    <InputNumber
                      min={1}
                      max={2048}
                      value={row.rule?.max_mb ?? 10}
                      onChange={(value) =>
                        patch(role.key, row.key, {
                          max_mb: Number(value ?? 10),
                        })
                      }
                      style={{ width: '100%' }}
                    />
                  ),
                },
                {
                  title: '允许的格式（留空=不限）',
                  render: (_, row) => (
                    <Select
                      mode="tags"
                      style={{ width: '100%' }}
                      placeholder="例如 jpg, png"
                      value={row.rule?.formats ?? []}
                      onChange={(values: string[]) =>
                        patch(role.key, row.key, {
                          formats: values
                            .map((item) => item.trim().toLowerCase())
                            .filter(Boolean),
                        })
                      }
                      tokenSeparators={[',', ' ']}
                    />
                  ),
                },
              ]}
            />
          </Card>
        ))}
      </Space>
    </PageShell>
  );
}
