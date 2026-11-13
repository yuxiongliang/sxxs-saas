import { InboxOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Empty,
  Flex,
  Input,
  Modal,
  Pagination,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import React, { useState } from 'react';
import AttachmentUpload from '@/components/AttachmentUpload';
import { listAttachments } from '@/services/system/api';
import type { AttachmentRecord } from '@/services/system/types';

interface AttachmentPickerProps {
  open: boolean;
  onCancel: () => void;
  /** 选中一张附件后回调；拿到的 `url` 是可公开访问的直链，可直接存进业务字段 */
  onSelect: (attachment: AttachmentRecord) => void;
  /** 默认只挑图片；传空字符串则不限类型 */
  category?: string;
  title?: string;
}

const PAGE_SIZE = 12;

const formatSize = (size: number) => {
  if (!size) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

/**
 * 附件选择器：从**已有的附件中心**里挑一张，而不是让用户手抄 URL。
 *
 * 之前站点品牌页的 Logo 是一个纯文本输入框，要求管理员去附件中心复制直链再粘回来 ——
 * 多跳一步、极易粘错，还不知道粘的是不是图片。这里直接复用 `/attachments` 列表接口，
 * 点图即选；顺手支持在本弹窗里现传一张（传完自动选中）。
 */
export default function AttachmentPicker({
  open,
  onCancel,
  onSelect,
  category = 'image',
  title = '选择图片',
}: AttachmentPickerProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['attachment-picker', category, page, keyword],
    queryFn: () =>
      listAttachments({
        current: page,
        pageSize: PAGE_SIZE,
        category: category || undefined,
        keyword: keyword || undefined,
      }),
    enabled: open,
  });

  const items = data?.list ?? [];

  const handleSelect = (record: AttachmentRecord) => {
    onSelect(record);
    setSelectedId(null);
    onCancel();
  };

  return (
    <Modal
      open={open}
      title={title}
      onCancel={() => {
        setSelectedId(null);
        onCancel();
      }}
      footer={null}
      width={880}
      destroyOnHidden
    >
      <Flex
        justify="space-between"
        align="center"
        gap={12}
        style={{ marginBottom: 12 }}
      >
        <Input.Search
          allowClear
          placeholder="按文件名搜索"
          style={{ maxWidth: 280 }}
          onSearch={(value) => {
            setKeyword(value.trim());
            setPage(1);
          }}
        />
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
            刷新
          </Button>
          <AttachmentUpload
            accept="image/*"
            multiple={false}
            sourceModule="brand"
            buttonText="上传新图片"
            onUploaded={(record) => {
              // 新传的图片直接选中，省一次翻页
              queryClient.invalidateQueries({
                queryKey: ['attachment-picker'],
              });
              message.success('已上传并选中');
              handleSelect(record);
            }}
          />
        </Space>
      </Flex>

      {isError ? (
        <Empty
          description={String((error as Error)?.message ?? '附件加载失败')}
        />
      ) : isLoading ? (
        <Flex justify="center" style={{ padding: 48 }}>
          <Spin />
        </Flex>
      ) : items.length === 0 ? (
        <Empty
          description={
            <>
              <InboxOutlined /> 还没有图片附件，先上传一张
            </>
          }
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 12,
          }}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedId(item.id)}
              onDoubleClick={() => handleSelect(item)}
              style={{
                padding: 8,
                border: `1px solid ${
                  selectedId === item.id ? '#1677ff' : '#f0f0f0'
                }`,
                borderRadius: 8,
                background: selectedId === item.id ? '#e6f4ff' : '#fff',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div
                style={{
                  height: 96,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  background: '#fafafa',
                  borderRadius: 6,
                }}
              >
                {item.category === 'image' ? (
                  <img
                    src={item.url}
                    alt={item.name}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      objectFit: 'contain',
                    }}
                  />
                ) : (
                  <Tag>{item.extension || item.category}</Tag>
                )}
              </div>
              <Typography.Text
                ellipsis
                style={{ display: 'block', marginTop: 8, fontSize: 12 }}
              >
                {item.name}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {formatSize(item.size)}
              </Typography.Text>
            </button>
          ))}
        </div>
      )}

      <Flex justify="space-between" align="center" style={{ marginTop: 16 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          单击选中，双击直接使用；选中的图片地址会写入当前字段。
        </Typography.Text>
        <Space>
          <Pagination
            size="small"
            current={page}
            pageSize={PAGE_SIZE}
            total={data?.total ?? 0}
            showSizeChanger={false}
            onChange={setPage}
          />
          <Button
            type="primary"
            disabled={selectedId === null}
            onClick={() => {
              const record = items.find((item) => item.id === selectedId);
              if (record) handleSelect(record);
            }}
          >
            使用选中的图片
          </Button>
        </Space>
      </Flex>
    </Modal>
  );
}
