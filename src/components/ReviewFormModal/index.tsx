import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Checkbox, Image, Input, Modal, Rate, Space } from 'antd';
import { useState } from 'react';
import AttachmentUpload from '@/components/AttachmentUpload';
import { createReview } from '@/services/commerce/api';
import type { ReviewMedia } from '@/services/commerce/types';
import type { AttachmentRecord } from '@/services/system/types';

/** 一条待评订单项（来自 `/portal/reviews/reviewable`）。 */
export interface ReviewableItem {
  order_item_id: number;
  order_id: number;
  product_id: number;
  product_name: string;
  sku_name: string;
  image?: string | null;
}

/**
 * 写评价弹窗：星级 + 文字 + 图片/视频。
 *
 * 媒体走附件中心的上传接口（买家的上传限额由平台的「上传限制」矩阵决定），
 * 存进 `product_reviews.media` 的是**公开直链**，否则买家端自己都看不到图。
 */
export default function ReviewFormModal({
  item,
  onClose,
  onDone,
}: {
  item?: ReviewableItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [media, setMedia] = useState<ReviewMedia[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const addMedia = (record: AttachmentRecord) => {
    const kind = record.mime_type?.startsWith('video') ? 'video' : 'image';
    // 评价只用公开直链；附件刚上传默认是 tenant 可见，后端发布时会统一转 public
    setMedia((prev) =>
      prev.length >= 6 ? prev : [...prev, { type: kind, url: record.url }],
    );
  };

  const submit = async () => {
    if (!item) return;
    setSubmitting(true);
    try {
      await createReview({
        order_item_id: item.order_item_id,
        rating,
        content: content.trim() || undefined,
        media,
        is_anonymous: anonymous,
      });
      message.success('评价已发布');
      setRating(5);
      setContent('');
      setMedia([]);
      setAnonymous(false);
      onDone();
    } catch (error) {
      message.error((error as Error).message || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="评价商品"
      open={Boolean(item)}
      onCancel={onClose}
      onOk={submit}
      okText="发布评价"
      confirmLoading={submitting}
      width={560}
    >
      {item ? (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space size={8}>
            {item.image ? (
              <img
                src={item.image}
                alt={item.product_name}
                style={{
                  width: 48,
                  height: 48,
                  objectFit: 'cover',
                  borderRadius: 4,
                }}
              />
            ) : null}
            <div>
              <div>{item.product_name}</div>
              <div style={{ color: '#999', fontSize: 12 }}>{item.sku_name}</div>
            </div>
          </Space>

          <div>
            <div style={{ marginBottom: 4 }}>评分</div>
            <Rate value={rating} onChange={setRating} />
          </div>

          <Input.TextArea
            rows={4}
            maxLength={1000}
            showCount
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="说说这次交易的体验：商品成色、卖家服务、物流速度…"
          />

          <div>
            <div style={{ marginBottom: 6 }}>图片 / 视频（最多 6 个）</div>
            <Space size={8} wrap>
              {media.map((one, index) => (
                <div key={one.url} style={{ position: 'relative' }}>
                  {one.type === 'video' ? (
                    /* biome-ignore lint/a11y/useMediaCaption: 买家上传的短视频没有字幕轨，补一个假 <track> 反而误导 */
                    <video
                      src={one.url}
                      style={{
                        width: 64,
                        height: 64,
                        objectFit: 'cover',
                        borderRadius: 4,
                      }}
                    />
                  ) : (
                    <Image
                      src={one.url}
                      width={64}
                      height={64}
                      style={{ objectFit: 'cover', borderRadius: 4 }}
                    />
                  )}
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    style={{ position: 'absolute', top: -8, right: -8 }}
                    onClick={() =>
                      setMedia((prev) => prev.filter((_, i) => i !== index))
                    }
                  />
                </div>
              ))}
              {media.length < 6 ? (
                <AttachmentUpload
                  sourceModule="product_review"
                  accept="image/*,video/*"
                  onUploaded={addMedia}
                >
                  <Button
                    icon={<PlusOutlined />}
                    style={{ height: 64, width: 64 }}
                  >
                    添加
                  </Button>
                </AttachmentUpload>
              ) : null}
            </Space>
          </div>

          <Checkbox
            checked={anonymous}
            onChange={(event) => setAnonymous(event.target.checked)}
          >
            匿名评价（前台只显示「匿名买家」；平台/运营仍能看到真实账号，用于处理纠纷）
          </Checkbox>
        </Space>
      ) : null}
    </Modal>
  );
}
