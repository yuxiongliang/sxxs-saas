import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Card, Input, Modal, Space } from 'antd';
import { useState } from 'react';
import ListToolbar from '@/components/ListToolbar';
import ProductReviewTable from '@/components/ProductReviewTable';
import SettingPage from '@/pages/system/components/SettingPage';
import {
  listAdminReviews,
  replyAdminReview,
  setAdminReviewStatus,
} from '@/services/commerce/api';
import type { ReviewRecord } from '@/services/commerce/types';

const STATUS_OPTIONS = [
  { label: '已展示', value: 'visible' },
  { label: '已隐藏', value: 'hidden' },
];

/**
 * 商品评论（运营视角）。
 *
 * 运营在这里能做两件事，权限都在 `product:moderate`：
 * 1. **隐藏/恢复** —— 违规、广告、人身攻击
 * 2. **回复** —— 代表店铺回应差评
 *
 * AI 审核列现在都是「未接入」：后端接口已预留（`services/review_moderation.py`），
 * 但**没有真接模型**，界面必须如实显示，不能让人以为内容已经被审过。
 */
export default function ProductReviewsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [moderationStatus, setModerationStatus] = useState<string>();
  const [replying, setReplying] = useState<ReviewRecord>();
  const [replyText, setReplyText] = useState('');

  const reviews = useQuery({
    queryKey: ['admin-reviews', keyword, status, moderationStatus],
    queryFn: () =>
      listAdminReviews({
        keyword,
        status,
        moderation_status: moderationStatus,
      }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['admin-reviews'] });

  const toggleStatus = async (record: ReviewRecord) => {
    const next = record.status === 'visible' ? 'hidden' : 'visible';
    await setAdminReviewStatus(record.id, next);
    message.success(
      next === 'hidden' ? '已隐藏，买家侧立即不可见' : '已恢复展示',
    );
    invalidate();
  };

  const submitReply = async () => {
    if (!replying) return;
    if (!replyText.trim()) {
      message.warning('回复内容不能为空');
      return;
    }
    await replyAdminReview(replying.id, replyText.trim());
    message.success('已回复');
    setReplying(undefined);
    setReplyText('');
    invalidate();
  };

  return (
    <SettingPage
      title="商品评论"
      subTitle="买家的真实评价；匿名的在这里也能看到是谁（出纠纷要能定位到人）"
      icon={<span>💬</span>}
    >
      <Card>
        <ListToolbar
          searchPlaceholder="搜商品名 / 用户名 / 用户ID / 评价内容"
          keyword={keyword ?? ''}
          onKeywordChange={(value) => setKeyword(value || undefined)}
          filters={
            <Space wrap>
              <select
                value={status ?? ''}
                onChange={(event) => setStatus(event.target.value || undefined)}
                style={{ height: 32, borderRadius: 6, padding: '0 8px' }}
              >
                <option value="">全部状态</option>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                value={moderationStatus ?? ''}
                onChange={(event) =>
                  setModerationStatus(event.target.value || undefined)
                }
                style={{ height: 32, borderRadius: 6, padding: '0 8px' }}
              >
                <option value="">全部 AI 审核状态</option>
                <option value="skipped">未接入</option>
                <option value="pending">待审</option>
                <option value="passed">通过</option>
                <option value="flagged">疑似违规</option>
                <option value="blocked">拦截</option>
              </select>
            </Space>
          }
          onRefresh={() => reviews.refetch()}
        />
        <ProductReviewTable
          data={reviews.data ?? []}
          loading={reviews.isLoading}
          canModerate
          canReply
          onReply={(record) => {
            setReplying(record);
            setReplyText(record.reply ?? '');
          }}
          onToggleStatus={toggleStatus}
        />
      </Card>

      <Modal
        title="回复评价"
        open={Boolean(replying)}
        onCancel={() => setReplying(undefined)}
        onOk={submitReply}
        okText="提交回复"
      >
        <Input.TextArea
          rows={4}
          maxLength={1000}
          showCount
          value={replyText}
          onChange={(event) => setReplyText(event.target.value)}
          placeholder="例如：非常抱歉给您带来不好的体验，已安排补发，请联系客服"
        />
      </Modal>
    </SettingPage>
  );
}
