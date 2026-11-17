import { request } from '@umijs/max';
import type { ApiResponse } from '@/services/system/types';
import type {
  ConversationRecord,
  ImReportRecord,
  MessageRecord,
  ReadState,
} from './types';

async function unwrap<T>(promise: Promise<ApiResponse<T>>): Promise<T> {
  const response = await promise;
  if (response.code !== 200) throw new Error(response.message || '请求失败');
  return response.data;
}

export async function getWsTicket() {
  return unwrap<{ ticket: string; expires_in: number }>(
    request('/api/v1/im/ws-ticket', { method: 'POST' }),
  );
}

export async function listConversations() {
  return unwrap<ConversationRecord[]>(
    request('/api/v1/im/conversations', { method: 'GET' }),
  );
}

/**
 * 建（或取回已有）与卖家的会话。
 *
 * 商品详情页的「在线客服」靠它：同一买家 + 同一卖家只会有一个会话，
 * 服务端会复用，不会点一次建一个。
 */
export async function createConversation(payload: { seller_id: number }) {
  return unwrap<ConversationRecord>(
    request('/api/v1/im/conversations', { method: 'POST', data: payload }),
  );
}

export async function listMessages(conversationId: number, afterSeq = 0) {
  return unwrap<MessageRecord[]>(
    request(`/api/v1/im/conversations/${conversationId}/messages`, {
      method: 'GET',
      params: { after_seq: afterSeq },
    }),
  );
}

export async function sendMessage(
  conversationId: number,
  content: string,
  clientMsgId: string,
) {
  return unwrap<MessageRecord>(
    request(`/api/v1/im/conversations/${conversationId}/messages`, {
      method: 'POST',
      data: { content, client_msg_id: clientMsgId },
    }),
  );
}

export async function sendImageMessage(
  conversationId: number,
  attachmentId: number,
  clientMsgId: string,
  caption = '',
) {
  return sendMediaMessage(conversationId, 'image', attachmentId, clientMsgId, caption);
}

/** 图片 / 视频共用：只是 type 不同，服务端会校验附件类型匹配。 */
export async function sendMediaMessage(
  conversationId: number,
  type: 'image' | 'video',
  attachmentId: number,
  clientMsgId: string,
  caption = '',
) {
  return unwrap<MessageRecord>(
    request(`/api/v1/im/conversations/${conversationId}/messages`, {
      method: 'POST',
      data: {
        type,
        attachment_id: attachmentId,
        content: caption,
        client_msg_id: clientMsgId,
      },
    }),
  );
}

/** 发商品卡片（必须属于本会话的卖家，服务端会校验）。 */
export async function sendProductMessage(
  conversationId: number,
  productId: number,
  clientMsgId: string,
) {
  return unwrap<MessageRecord>(
    request(`/api/v1/im/conversations/${conversationId}/messages`, {
      method: 'POST',
      data: { type: 'product', product_id: productId, client_msg_id: clientMsgId },
    }),
  );
}

/** 撤回自己的消息（2 分钟窗口，服务端校验）。 */
export async function recallMessage(messageId: number) {
  return unwrap<MessageRecord>(
    request(`/api/v1/im/messages/${messageId}/recall`, { method: 'POST' }),
  );
}

/** 编辑自己的文本消息（15 分钟窗口，服务端校验）。 */
export async function editMessage(messageId: number, content: string) {
  return unwrap<MessageRecord>(
    request(`/api/v1/im/messages/${messageId}`, {
      method: 'PATCH',
      data: { content },
    }),
  );
}

/** 软删会话（只影响自己）。 */
export async function hideConversation(conversationId: number) {
  return unwrap<null>(
    request(`/api/v1/im/conversations/${conversationId}`, { method: 'DELETE' }),
  );
}

/** 搜会话（对端名/店铺名）与消息内容，只搜自己参与的会话。 */
export async function searchIm(keyword: string) {
  return unwrap<{
    conversations: number[];
    messages: Array<{
      id: number;
      conversation_id: number;
      content: string;
      created_at: string | null;
    }>;
  }>(request('/api/v1/im/search', { method: 'GET', params: { keyword } }));
}

export async function markConversationRead(conversationId: number, seq: number) {
  return unwrap<ReadState>(
    request(`/api/v1/im/conversations/${conversationId}/read`, {
      method: 'POST',
      data: { seq },
    }),
  );
}

export async function getReadState(conversationId: number) {
  return unwrap<ReadState>(
    request(`/api/v1/im/conversations/${conversationId}/read-state`, {
      method: 'GET',
    }),
  );
}

export async function reportMessage(messageId: number, reason: string) {
  return unwrap<ImReportRecord>(
    request(`/api/v1/im/messages/${messageId}/report`, {
      method: 'POST',
      data: { reason },
    }),
  );
}

export async function listImReports(status?: string) {
  return unwrap<ImReportRecord[]>(
    request('/api/v1/im/reports', { method: 'GET', params: { status } }),
  );
}

export async function handleImReport(
  reportId: number,
  action: 'accept' | 'reject',
  note = '',
) {
  return unwrap<ImReportRecord>(
    request(`/api/v1/im/reports/${reportId}/handle`, {
      method: 'POST',
      data: { action, note },
    }),
  );
}
