import { PictureOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { App, Button, Flex, Image, Space, Typography, theme } from 'antd';
import { useState } from 'react';
import AttachmentPicker from '@/components/AttachmentPicker';
import type { AttachmentRecord } from '@/services/system/types';

/** 与后端 `api/v1/attachments.py` 的公开直链前缀保持一致 */
export const PUBLIC_ATTACHMENT_PREFIX = '/api/v1/attachments/public/';

/**
 * 图片 / 视频字段：**选中即预览**，不显示链接文本。
 *
 * 三条踩过的坑，都在这里统一处理，不再各页面重复：
 *
 * 1. **存相对直链** `/api/v1/attachments/public/{id}`，而不是附件表里的绝对 url ——
 *    绝对地址指向后端 `public_base_url`，租户换了自己的域名就打错站。
 * 2. **刚选完预览会 404**：附件上传后默认 `visibility=tenant`，`/public/{id}` 不放行，
 *    要等保存时后端把它标成 public。所以刚选中的那一下用 `record.url` 做临时预览，
 *    保存后自动换回稳定直链。
 * 3. **类型必须匹配**：主图槽里选了视频不能「静默清空主图」，要直接拒绝并提示，
 *    否则用户会以为存上了，回到前台发现图没了。
 */
export default function MediaField({
  value,
  onChange,
  kind = 'image',
  title,
  boxSize = 96,
}: {
  value?: string | null;
  onChange?: (value: string) => void;
  /** 这个槽位只收图片还是只收视频 */
  kind?: 'image' | 'video';
  /** 弹窗标题，如「选择商品主图」 */
  title: string;
  boxSize?: number;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [freshPreview, setFreshPreview] = useState<string>();
  // 刚选中的那一张：直链还没发布，先用附件原始 url 预览
  const preview = freshPreview ?? value ?? undefined;
  const isVideo = kind === 'video';

  const handlePicked = (record: AttachmentRecord) => {
    const pickedVideo =
      record.category === 'video' || record.mime_type?.startsWith('video');
    if (isVideo !== Boolean(pickedVideo)) {
      // 不静默清空：明确告诉用户选错了槽位
      setOpen(false);
      message.warning(
        isVideo ? '这里只能选视频' : '这里只能选图片，视频请用「商品视频」字段',
      );
      return;
    }
    setFreshPreview(record.url);
    onChange?.(`${PUBLIC_ATTACHMENT_PREFIX}${record.id}`);
  };

  return (
    <Space orientation="vertical" size={8} style={{ width: '100%' }}>
      <Flex align="center" gap={12} wrap>
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={isVideo ? '点击选择视频' : '点击选择图片'}
          data-testid={isVideo ? 'media-field-video' : 'media-field-image'}
          style={{
            width: boxSize,
            height: boxSize,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            padding: 0,
            border: `1px dashed ${token.colorBorder}`,
            borderRadius: 8,
            background: token.colorFillQuaternary,
            cursor: 'pointer',
          }}
        >
          {preview ? (
            isVideo ? (
              <video
                src={preview}
                style={{ maxWidth: '100%', maxHeight: '100%' }}
                muted
              />
            ) : (
              <Image
                src={preview}
                alt={title}
                preview={false}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                }}
              />
            )
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {isVideo ? <VideoCameraOutlined /> : '点击选图'}
            </Typography.Text>
          )}
        </button>
        <Space wrap>
          <Button
            icon={isVideo ? <VideoCameraOutlined /> : <PictureOutlined />}
            onClick={() => setOpen(true)}
          >
            {value ? '更换' : isVideo ? '选择视频' : '选择图片'}
          </Button>
          {value ? (
            <Button
              danger
              onClick={() => {
                setFreshPreview(undefined);
                onChange?.('');
              }}
            >
              清除
            </Button>
          ) : null}
        </Space>
      </Flex>
      <AttachmentPicker
        open={open}
        title={title}
        category={kind}
        accept={isVideo ? 'video/*' : 'image/*'}
        onCancel={() => setOpen(false)}
        onSelect={handlePicked}
      />
    </Space>
  );
}
