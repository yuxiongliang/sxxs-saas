import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Card, Input, Modal, Space } from 'antd';
import { useState } from 'react';
import ProductReviewTable from '@/components/ProductReviewTable';
import { listSellerReviews, replySellerReview } from '@/services/commerce/api';
import type { ReviewRecord } from '@/services/commerce/types';
import SellerShell from '../components/SellerShell';

/**
 * 我的评价（卖家侧）：自己商品收到的评价。
 *
 * **卖家只能回复，不能隐藏** —— 隐藏是运营/平台的权力（`canModerate` 不传）。
 */
export default function SellerReviewsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState<string>();
  const [replying, setReplying] = useState<ReviewRecord>();
  const [replyText, setReplyText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reviews = useQuery({
    queryKey: ['seller-reviews', keyword],
    queryFn: () => listSellerReviews({ keyword }),
  });

  const submitReply = async () => {
    if (!replying) return;
    if (!replyText.trim()) {
      message.warning('回复内容不能为空');
      return;
    }
    setSubmitting(true);
    try {
      await replySellerReview(replying.id, replyText.trim());
      message.success('已回复');
      setReplying(undefined);
      setReplyText('');
      queryClient.invalidateQueries({ queryKey: ['seller-reviews'] });
    } catch (error) {
      message.error((error as Error)?.message || '回复失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SellerShell title="我的评价">
      <Card>
        <Input.Search
          allowClear
          placeholder="搜商品名 / 用户名 / 评价内容"
          style={{ width: 300, marginBottom: 16 }}
          onSearch={(value) => setKeyword(value.trim() || undefined)}
        />
        <ProductReviewTable
          data={reviews.data ?? []}
          loading={reviews.isLoading}
          canReply
          onReply={(record) => {
            setReplying(record);
            setReplyText(record.reply ?? '');
          }}
        />
      </Card>

      <Modal
        title="回复评价"
        open={Boolean(replying)}
        onCancel={() => setReplying(undefined)}
        onOk={submitReply}
        confirmLoading={submitting}
        okText="提交回复"
      >
        <Space orientation="vertical" style={{ width: '100%' }}>
          <span
            style={{ color: 'var(--ant-color-text-secondary)', fontSize: 12 }}
          >
            {replying?.content || '（买家只打了分，没写内容）'}
          </span>
          <Input.TextArea
            rows={4}
            maxLength={1000}
            showCount
            value={replyText}
            onChange={(event) => setReplyText(event.target.value)}
            placeholder="例如：抱歉让您不满意，已私信您处理方案"
          />
        </Space>
      </Modal>
    </SellerShell>
  );
}
