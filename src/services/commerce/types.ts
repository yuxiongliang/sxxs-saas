export interface SellerRecord {
  id: number;
  display_name: string;
  seller_type: string;
  status: string;
  kyc_status: string;
  /** 卖家归属的登录用户（后台列用） */
  owner_user_id?: number;
  owner_username?: string | null;
  owner_public_id?: string | null;
}

export interface CategoryRecord {
  id: number;
  name: string;
  slug: string;
  sort: number;
  status: string;
  /** 分类默认抽佣比例（万分比，500 = 5%） */
  default_commission_bps: number;
  /** 被多少商品引用（删除前的判据） */
  product_count: number;
}

export interface ProductSkuRecord {
  id: number;
  sku_code: string;
  name: string;
  price_cents: number;
  stock: number;
  locked_stock: number;
  status: string;
  /** {规格组名: 规格值}，无规格商品为空 */
  specs?: Record<string, string>;
  /** SKU 级覆盖图，优先生效 */
  image_url?: string | null;
  video_url?: string | null;
}

export interface SpecValueRecord {
  value: string;
  image_url?: string | null;
  video_url?: string | null;
}

export interface SpecGroupRecord {
  name: string;
  values: SpecValueRecord[];
}

export interface ProductRecord {
  id: number;
  seller_id: number;
  shop_id: number;
  category_id?: number | null;
  name: string;
  subtitle?: string | null;
  description?: string | null;
  status: string;
  main_image?: string | null;
  images?: string[];
  created_at?: string | null;
  updated_at?: string | null;
  /** 列表里 join 出来的可读名字，不用再显示裸 ID */
  seller_name?: string | null;
  /** 卖家登录用户名（商品列表第一列用） */
  seller_owner_username?: string | null;
  seller_owner_public_id?: string | null;
  shop_name?: string | null;
  sku_count?: number;
  /** 已停用的历史 SKU 数（不计入库存/价格统计，仅提示） */
  inactive_sku_count?: number;
  /** 全部 SKU 库存合计 */
  stock?: number;
  locked_stock?: number;
  skus?: ProductSkuRecord[];
  /** 规格树（多规格）；无规格商品为空数组 */
  spec_groups?: SpecGroupRecord[];
  video_url?: string | null;
  /** 商品级抽佣比例（万分比），空 = 继承分类默认 */
  commission_bps?: number | null;
  commission_locked?: boolean;
  reject_reason?: string | null;
  /** 列表页展示的首个 SKU 价格 */
  price_cents?: number | null;
  // ---- 统计（口径见 backend/app/services/catalog_stats.py，四端共用）----
  /** 销量：已付款未退款的件数 */
  sold_count?: number;
  /** 浏览：买家侧详情页 PV（刷新也计） */
  view_count?: number;
  favorite_count?: number;
  review_count?: number;
  /** 平均分，无评价时为 null（界面显示「—」而不是 0 分） */
  rating_avg?: number | null;
}

export interface OrderRecord {
  id: number;
  order_no: string;
  buyer_id: number;
  /** 买家归属人（全站只展示用户ID + 用户名） */
  buyer_public_id?: string | null;
  buyer_username?: string | null;
  status: string;
  payable_amount_cents: number;
}

export interface SellerOrderRecord {
  id: number;
  seller_id: number;
  /** 卖家归属人：用户ID + 用户名，店铺名只做副行 */
  seller_name?: string | null;
  seller_public_id?: string | null;
  seller_username?: string | null;
  status: string;
  goods_amount_cents: number;
  commission_amount_cents: number;
  payable_to_seller_cents: number;
}

export interface OrderItemRecord {
  id: number;
  product_name: string;
  sku_name: string;
  price_cents: number;
  quantity: number;
  subtotal_cents: number;
}

export interface PortalProduct {
  id: number;
  seller_id: number;
  shop_id: number;
  name: string;
  subtitle?: string;
  status: string;
  main_image?: string;
  sku?: { id: number; name: string; price_cents: number; stock: number };
}

export interface SellerProfile {
  id: number;
  display_name: string;
  status: string;
  kyc_status: string;
  shop?: { id: number; name: string; slug: string } | null;
}

export interface SellerProductRecord {
  id: number;
  name: string;
  subtitle?: string | null;
  description?: string | null;
  main_image?: string | null;
  status: string;
  /** 被驳回时运营给的原因，重新提交后清空 */
  reject_reason?: string | null;
  /** 佣金比例（万分比）与锁定状态：被运营调过就锁住，卖家不能改 */
  commission_bps?: number | null;
  commission_locked?: boolean;
  category_id?: number | null;
  price_cents: number;
  stock: number;
  sku_id?: number | null;
  locked_stock?: number;
  // ---- 统计（与租户运营端、平台端同一口径）----
  sold_count?: number;
  view_count?: number;
  favorite_count?: number;
  review_count?: number;
  rating_avg?: number | null;
}

export interface SellerOrderRecord {
  id: number;
  order_id: number;
  seller_order_no: string;
  status: string;
  goods_amount_cents: number;
  commission_amount_cents: number;
  payable_to_seller_cents: number;
}

export interface PortalOrder {
  id: number;
  order_no: string;
  status: string;
  payable_amount_cents: number;
  created_at?: string;
}

export interface SellerLedgerEntry {
  id: number;
  type: string;
  amount_cents: number;
  seller_order_id?: number;
  created_at: string;
}

export interface SellerLedger {
  seller_id: number;
  balance_cents: number;
  available_cents?: number;
  pending_cents?: number;
  hold_days?: number;
  entries: SellerLedgerEntry[];
}

export interface OrderDetail extends OrderRecord {
  seller_orders: SellerOrderRecord[];
  items: OrderItemRecord[];
}

export interface PortalProductSku {
  id: number;
  sku_code: string;
  name: string;
  price_cents: number;
  stock: number;
  status: string;
}

export interface PortalProductDetail {
  id: number;
  name: string;
  subtitle?: string;
  description?: string;
  status: string;
  main_image?: string;
  images?: string[];
  seller_id: number;
  seller_name?: string;
  shop_id: number;
  shop_name?: string;
  skus: PortalProductSku[];
}

export interface CartItemRecord {
  id: number;
  product_id: number;
  sku_id: number;
  seller_id: number;
  quantity: number;
  selected: boolean;
  product_name: string;
  sku_name: string;
  price_cents: number;
  stock: number;
  main_image?: string;
  subtotal_cents: number;
  available: boolean;
}

export interface CartSummary {
  items: CartItemRecord[];
  selected_count: number;
  selected_amount_cents: number;
  total_count: number;
  invalid_count: number;
}

export interface AddressRecord {
  id: number;
  receiver_name: string;
  receiver_phone: string;
  province: string;
  city: string;
  district: string;
  detail: string;
  is_default: boolean;
}

export interface PayoutRecord {
  id: number;
  seller_id: number;
  /** 卖家归属人：用户ID + 用户名，店铺名只做副行 */
  seller_public_id?: string | null;
  seller_username?: string | null;
  seller_name?: string | null;
  amount_cents: number;
  status: string;
  reject_reason: string;
  settlement_batch_id?: number | null;
  requested_by?: number | null;
  reviewed_by?: number | null;
  paid_at?: string | null;
}

export interface SettlementBatchRecord {
  id: number;
  batch_no: string;
  period_start: string;
  period_end: string;
  status: string;
  total_amount_cents: number;
  seller_count: number;
  payout_count: number;
  note: string;
  confirmed_at?: string | null;
  paid_at?: string | null;
}

/** 商品评价里的一条附件（图或视频）。存的是公开直链，不是附件表 id。 */
export interface ReviewMedia {
  type: 'image' | 'video';
  url: string;
}

/**
 * 收藏记录（四端共用同一形状）。
 *
 * 人物标识一律 `user_public_id` + `user_username`，不返回裸 user_id。
 */
export interface FavoriteRecord {
  id: number;
  tenant_id?: number;
  product_id: number;
  product_name: string;
  product_image?: string | null;
  product_status?: string;
  seller_shop_name?: string | null;
  seller_name?: string | null;
  user_public_id?: string | null;
  user_username?: string | null;
  created_at?: string | null;
}

/**
 * 管理侧评价（运营 / 卖家 / 平台共用）。
 *
 * 与买家侧的区别：**匿名评价在这里也带真实用户信息**（`is_anonymous` 只用于标注）。
 */
export interface ReviewRecord {
  id: number;
  tenant_id?: number;
  product_id: number;
  product_name: string;
  product_image?: string | null;
  sku_name?: string | null;
  seller_shop_name?: string | null;
  seller_name?: string | null;
  rating: number;
  content?: string | null;
  media?: ReviewMedia[];
  is_anonymous?: boolean;
  user_public_id?: string | null;
  user_username?: string | null;
  status: string;
  moderation_status?: string;
  moderation_note?: string | null;
  reply?: string | null;
  replied_at?: string | null;
  created_at?: string | null;
}

/** 买家侧公开评价（匿名的已脱敏，不含任何可识别信息）。 */
export interface PublicReview {
  id: number;
  rating: number;
  content?: string | null;
  media?: ReviewMedia[];
  is_anonymous?: boolean;
  display_name: string;
  reply?: string | null;
  replied_at?: string | null;
  created_at?: string | null;
}
