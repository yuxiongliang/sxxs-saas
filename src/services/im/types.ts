export interface ConversationRecord {
  id: number;
  buyer_id: number;
  /** 买家：用户ID + 用户名 */
  buyer_public_id?: string | null;
  buyer_username?: string | null;
  seller_id: number;
  /** 卖家：store 名 + 归属用户ID/用户名 */
  seller_name?: string | null;
  seller_public_id?: string | null;
  seller_username?: string | null;
  order_id?: number;
  status: string;
  buyer_unread_count: number;
  seller_unread_count: number;
}

export interface MessagePayload {
  attachment_id?: number;
  url?: string;
  mime_type?: string;
  size?: number;
  /** 商品卡片消息 */
  product_id?: number;
  snapshot?: {
    name: string;
    price_cents?: number | null;
    image?: string | null;
    status?: string;
  };
}

export interface MessageRecord {
  id: number;
  conversation_id: number;
  sender_id: number;
  client_msg_id: string;
  seq: number;
  type: string;
  content: string;
  payload?: MessagePayload | null;
  status: string;
  /** 撤回时间：有值则展示「该消息已撤回」 */
  recalled_at?: string | null;
  /** 编辑时间：有值则展示「已编辑」 */
  edited_at?: string | null;
  /** 发送时间：前端靠它判断 2 分钟撤回 / 15 分钟编辑窗口 */
  created_at?: string | null;
}

export interface ReadState {
  conversation_id: number;
  my_last_read_seq: number;
  peer_last_read_seq: number;
  buyer_unread_count: number;
  seller_unread_count: number;
}

export interface ImReportRecord {
  id: number;
  conversation_id: number;
  message_id: number;
  reporter_id: number;
  reason: string;
  status: string;
  note: string;
}
