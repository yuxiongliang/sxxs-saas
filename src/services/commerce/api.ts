import { request } from '@umijs/max';
import type { ApiResponse } from '@/services/system/types';
import type {
  AddressRecord,
  CategoryRecord,
  CartItemRecord,
  CartSummary,
  FavoriteRecord,
  OrderDetail,
  OrderRecord,
  PortalOrder,
  PortalProduct,
  PayoutRecord,
  ProductRecord,
  ProductSkuRecord,
  PublicReview,
  ReviewMedia,
  ReviewRecord,
  SellerLedger,
  SellerOrderRecord,
  SellerProductRecord,
  SellerProfile,
  SellerRecord,
  SettlementBatchRecord,
} from './types';

async function unwrap<T>(promise: Promise<ApiResponse<T>>): Promise<T> {
  const response = await promise;
  if (response.code !== 200) throw new Error(response.message || '请求失败');
  return response.data;
}

export async function getSellerProfile() {
  return unwrap<SellerProfile>(
    request('/api/v1/portal/seller/profile', { method: 'GET' }),
  );
}

/** 卖家维护店铺资料：自提点地址与说明在这里填（自提单买家要看）。 */
export async function updateSellerShop(data: {
  name?: string;
  description?: string;
  address?: string;
  pickup_note?: string;
}) {
  return unwrap<{
    id: number;
    name: string;
    description?: string | null;
    address?: string | null;
    pickup_note?: string | null;
  }>(request('/api/v1/portal/seller/shop', { method: 'PUT', data }));
}

export async function listSellerProducts(params?: {
  product_type?: string;
}) {
  return unwrap<SellerProductRecord[]>(
    request('/api/v1/portal/seller/products', { method: 'GET', params }),
  );
}

export async function createSellerProduct(data: {
  name: string;
  price_cents: number;
  stock: number;
  /** 类型创建时确定、之后不可改；目前后端只接受 physical */
  product_type?: string;
  category_id?: number | null;
  main_image?: string;
  video_url?: string;
  /** 交付方式（向导第 5 步）：至少一个，不选后端拒绝发布 */
  delivery_methods?: string[];
  /** 向导第 4 步「详情」：不传就会被静默丢弃 */
  description?: string;
  description_doc?: Record<string, unknown>;
  description_html?: string;
}) {
  return unwrap<{ id: number; name: string; status: string }>(
    request('/api/v1/portal/seller/products', { method: 'POST', data }),
  );
}

/** 卖家商品详情：编辑向导回显规格树与全部 SKU（与运营端同形状）。 */
export async function getSellerProduct(id: number) {
  return unwrap<ProductRecord>(
    request(`/api/v1/portal/seller/products/${id}`, { method: 'GET' }),
  );
}

/** 卖家保存规格树：在售商品改规格会重新过审。 */
export async function saveSellerProductSpecs(
  id: number,
  data: ProductSpecsPayload,
) {
  return unwrap<{ id: number; status: string; bounced_to_review: boolean }>(
    request(`/api/v1/portal/seller/products/${id}/specs`, {
      method: 'PUT',
      data,
    }),
  );
}

/** 卖家选分类：平台级分类，卖家只读（与运营端同一份数据）。 */
export async function listSellerCategories() {
  return unwrap<CategoryRecord[]>(
    request('/api/v1/portal/seller/categories', { method: 'GET' }),
  );
}

/** 卖家改自己的商品：在售商品改内容/改价会自动打回待审核。 */
export async function updateSellerProduct(
  id: number,
  data: {
    name?: string;
    description?: string;
    main_image?: string;
    video_url?: string;
    category_id?: number | null;
    description_doc?: Record<string, unknown>;
    description_html?: string;
    delivery_methods?: string[];
    price_cents?: number;
    stock?: number;
    commission_bps?: number;
  },
) {
  return unwrap<{
    id: number;
    name: string;
    status: string;
    reject_reason?: string | null;
    price_cents: number;
    stock: number;
    bounced_to_review: boolean;
  }>(request(`/api/v1/portal/seller/products/${id}`, { method: 'PUT', data }));
}

/** 卖家只能：自己下架（on_sale→off_sale）、被驳回后重新提交（→pending_review）。 */
export async function changeSellerProductStatus(
  id: number,
  status: 'off_sale' | 'pending_review',
) {
  return unwrap<{ id: number; status: string }>(
    request(`/api/v1/portal/seller/products/${id}/status`, {
      method: 'POST',
      data: { status },
    }),
  );
}

/** 卖家发货：快递要运单号；自提单只标记「备货完成」，不传运单。 */
export async function shipMySellerOrder(
  id: number,
  data?: { carrier?: string; tracking_no?: string },
) {
  return unwrap<{ id: number; status: string }>(
    request(`/api/v1/portal/seller/orders/${id}/ship`, { method: 'POST', data }),
  );
}

/** 卖家同意退款（买家申请过则复用那条待处理记录）。 */
export async function refundMySellerOrder(
  id: number,
  data: { amount_cents: number; reason?: string },
) {
  return unwrap<{ id: number; status: string }>(
    request(`/api/v1/portal/seller/orders/${id}/refund`, {
      method: 'POST',
      data: { amount_cents: data.amount_cents, reason: data.reason ?? '' },
    }),
  );
}

/** 卖家驳回买家售后申请。 */
export async function rejectMySellerOrderRefund(id: number, reason: string) {
  return unwrap<{ id: number; status: string }>(
    request(`/api/v1/portal/seller/orders/${id}/refund/reject`, {
      method: 'POST',
      data: { reason },
    }),
  );
}

export async function requestSellerPayout() {
  return unwrap<{ id: number; amount_cents: number; status: string }>(
    request('/api/v1/portal/seller/payouts', { method: 'POST' }),
  );
}

export async function listSellerOrders() {
  return unwrap<SellerOrderRecord[]>(
    request('/api/v1/portal/seller/orders', { method: 'GET' }),
  );
}

export async function listPortalProducts() {
  return unwrap<PortalProduct[]>(
    request('/api/v1/portal/products', { method: 'GET' }),
  );
}

export async function listPortalOrders() {
  return unwrap<PortalOrder[]>(
    request('/api/v1/portal/orders', { method: 'GET' }),
  );
}

export async function createPortalOrder(data: {
  sku_id: number;
  quantity: number;
  receiver_name: string;
  receiver_phone: string;
  receiver_address: { detail: string };
}) {
  return unwrap<PortalOrder>(
    request('/api/v1/portal/orders', {
      method: 'POST',
      data: {
        items: [{ sku_id: data.sku_id, quantity: data.quantity }],
        receiver_name: data.receiver_name,
        receiver_phone: data.receiver_phone,
        receiver_address: data.receiver_address,
      },
    }),
  );
}

/**
 * 发起**真实**支付（微信 / 支付宝）。
 *
 * 返回 `{type:'redirect', url}`（支付宝：整页跳转）或 `{type:'qrcode', code_url}`（微信扫码）。
 * 渠道没配好时后端会 400 并列出缺哪些字段 —— 不要吞掉这个错误。
 */
export async function createOrderPayment(
  orderId: number,
  provider: 'alipay' | 'wechat',
) {
  return unwrap<{
    type: 'redirect' | 'qrcode' | 'already_paid';
    url?: string;
    code_url?: string;
    out_trade_no?: string;
    amount_cents?: number;
  }>(
    request(`/api/v1/portal/orders/${orderId}/payments`, {
      method: 'POST',
      data: { provider },
    }),
  );
}

/** 主动查询渠道状态（回调丢失/用户付完没跳回来时兜底）。 */
export async function queryOrderPayment(
  orderId: number,
  provider: 'alipay' | 'wechat',
) {
  return unwrap<{
    paid: boolean;
    payment_status: string;
    fulfillment_status: string;
    trade_no?: string;
  }>(
    request(`/api/v1/portal/orders/${orderId}/payments/query`, {
      method: 'POST',
      data: { provider },
    }),
  );
}

export async function mockPayPortalOrder(
  id: number,
  method: 'wallet' | 'wechat' | 'alipay' = 'wallet',
) {
  return unwrap<{
    id: number;
    payment_status: string;
    fulfillment_status: string;
    provider: string;
  }>(
    request(`/api/v1/portal/orders/${id}/mock-pay`, {
      method: 'POST',
      data: { method },
    }),
  );
}

/** 买家撤回售后申请（卖家还没处理时）。 */
export async function cancelPortalRefund(id: number) {
  return unwrap<{
    id: number;
    payment_status: string;
    fulfillment_status: string;
  }>(
    request(`/api/v1/portal/orders/${id}/refund-request/cancel`, {
      method: 'POST',
    }),
  );
}

/**
 * 买家申请售后（整单）。完成后（completed）后端会拒绝 —— 交易结束即关闭售后入口。
 */
export async function requestPortalRefund(id: number, reason: string) {
  return unwrap<{ id: number; payment_status: string; fulfillment_status: string }>(
    request(`/api/v1/portal/orders/${id}/refund-request`, {
      method: 'POST',
      data: { amount_cents: 1, reason },
    }),
  );
}

export async function confirmPortalOrder(id: number) {
  return unwrap<{ id: number; status: string }>(
    request(`/api/v1/portal/orders/${id}/confirm`, { method: 'POST' }),
  );
}

export async function listAdminSellers(params?: {
  keyword?: string;
  status?: string;
  seller_type?: string;
  kyc_status?: string;
}) {
  return unwrap<SellerRecord[]>(
    request('/api/v1/admin/sellers', { method: 'GET', params }),
  );
}

/** 商品分类：平台统一定义，租户端只读。 */
export async function listAdminCategories(params?: { keyword?: string }) {
  return unwrap<CategoryRecord[]>(
    request('/api/v1/admin/categories', { method: 'GET', params }),
  );
}

export async function listAdminProducts(params?: {
  keyword?: string;
  status?: string;
  category_id?: number;
  product_type?: string;
}) {
  return unwrap<ProductRecord[]>(
    request('/api/v1/admin/products', { method: 'GET', params }),
  );
}

export async function getAdminProduct(id: number) {
  return unwrap<ProductRecord>(
    request(`/api/v1/admin/products/${id}`, { method: 'GET' }),
  );
}

export async function reviewSeller(id: number, data: { status: string; kyc_status: string }) {
  return unwrap<SellerRecord>(
    request(`/api/v1/admin/sellers/${id}/review`, { method: 'POST', data }),
  );
}

export async function updateAdminProduct(
  id: number,
  data: {
    name?: string;
    description?: string;
    main_image?: string;
    video_url?: string;
    images?: string[];
    category_id?: number | null;
    commission_bps?: number;
  },
) {
  return unwrap<ProductRecord>(
    request(`/api/v1/admin/products/${id}`, { method: 'PUT', data }),
  );
}

/** 运营改过的佣金比例会锁定，卖家不能再改；这个接口把决定权还给卖家。 */
export async function unlockAdminProductCommission(id: number) {
  return unwrap<{ id: number; commission_locked: boolean; commission_bps: number | null }>(
    request(`/api/v1/admin/products/${id}/commission-unlock`, { method: 'POST' }),
  );
}

/**
 * 规格树载荷。运营端和卖家端**必须是同一个形状** ——
 * 保存规格的是同一个后端函数（catalog_specs.save_specs），
 * 两边各写一份类型迟早会漂。
 */
export interface ProductSpecsPayload {
  groups: Array<{
    name: string;
    values: Array<{
      value: string;
      image_url?: string | null;
      video_url?: string | null;
    }>;
  }>;
  skus: Array<{
    specs: Record<string, string>;
    price_cents?: number;
    stock?: number;
    image_url?: string | null;
    video_url?: string | null;
    status?: string;
  }>;
}

/** 保存规格树：规格值做笛卡尔积生成 SKU（后端按组合键匹配，老组合保留价/库存）。 */
export async function updateAdminProductSpecs(
  id: number,
  data: ProductSpecsPayload,
) {
  return unwrap<{ id: number; status: string; skus: ProductSkuRecord[] }>(
    request(`/api/v1/admin/products/${id}/specs`, { method: 'PUT', data }),
  );
}

/** 上下架 / 审核：后端有状态机，非法迁移会返回 400。驳回可带原因给卖家看。 */
export async function changeAdminProductStatus(
  id: number,
  status: string,
  reason?: string,
) {
  return unwrap<ProductRecord>(
    request(`/api/v1/admin/products/${id}/status`, {
      method: 'POST',
      data: reason ? { status, reason } : { status },
    }),
  );
}

/** 改价 / 改库存（库存变更会写 InventoryLog）。 */
export async function updateAdminProductSku(
  productId: number,
  skuId: number,
  data: { price_cents?: number; stock?: number },
) {
  return unwrap<ProductRecord>(
    request(`/api/v1/admin/products/${productId}/skus/${skuId}`, {
      method: 'PUT',
      data,
    }),
  );
}

export async function getSellerLedger(id: number) {
  return unwrap<SellerLedger>(
    request(`/api/v1/admin/sellers/${id}/ledger`, { method: 'GET' }),
  );
}

export async function createSellerPayout(id: number) {
  return unwrap<{ id: number; amount_cents: number; status: string }>(
    request(`/api/v1/admin/sellers/${id}/payouts`, { method: 'POST' }),
  );
}

export async function listAdminOrders(params?: {
  keyword?: string;
  /** 支付状态筛选（钱） */
  payment_status?: string;
  /** 履约状态筛选（货） */
  fulfillment_status?: string;
}) {
  return unwrap<OrderRecord[]>(
    request('/api/v1/admin/orders', { method: 'GET', params }),
  );
}

export async function getAdminOrderDetail(id: number) {
  return unwrap<OrderDetail>(
    request(`/api/v1/admin/orders/${id}`, { method: 'GET' }),
  );
}

export async function shipSellerOrder(
  id: number,
  data: { carrier: string; tracking_no: string },
) {
  return unwrap<{ id: number; status: string }>(
    request(`/api/v1/admin/seller-orders/${id}/ship`, { method: 'POST', data }),
  );
}

export async function refundSellerOrder(
  id: number,
  data: { amount_cents: number; reason?: string },
) {
  return unwrap<{ id: number; status: string }>(
    request(`/api/v1/admin/seller-orders/${id}/refund`, { method: 'POST', data }),
  );
}

export async function mockPayOrder(id: number) {
  return unwrap<{ id: number; status: string }>(
    request(`/api/v1/admin/orders/${id}/mock-pay`, { method: 'POST' }),
  );
}

export async function cancelOrder(id: number) {
  return unwrap<{ id: number; status: string }>(
    request(`/api/v1/admin/orders/${id}/cancel`, { method: 'POST' }),
  );
}

// ---------------------------------------------------------------------------
// 买家商城：购物车 / 地址簿
// （商品详情已全部走 `/public/products/{id}`，旧的 `/portal/products/{id}` 页面已删除；
//   副标题也随之下线，`getPortalProductDetail` 一并移除）
// ---------------------------------------------------------------------------

export async function getPortalCart() {
  return unwrap<CartSummary>(request('/api/v1/portal/cart', { method: 'GET' }));
}

export async function addCartItem(data: { sku_id: number; quantity: number }) {
  return unwrap<CartItemRecord>(
    request('/api/v1/portal/cart/items', { method: 'POST', data }),
  );
}

export async function updateCartItem(
  id: number,
  data: { quantity?: number; selected?: boolean },
) {
  return unwrap<CartItemRecord>(
    request(`/api/v1/portal/cart/items/${id}`, { method: 'PUT', data }),
  );
}

export async function deleteCartItem(id: number) {
  return unwrap<null>(
    request(`/api/v1/portal/cart/items/${id}`, { method: 'DELETE' }),
  );
}

export async function clearPortalCart() {
  return unwrap<{ removed: number }>(
    request('/api/v1/portal/cart', { method: 'DELETE' }),
  );
}

export async function checkoutCart(data: {
  receiver_name?: string;
  receiver_phone?: string;
  receiver_address?: Record<string, string>;
  address_id?: number;
  remark?: string;
  /** 按卖家选交付方式：一单可拆多卖家单 */
  delivery?: Array<{ seller_id: number; delivery_method: string }>;
}) {
  return unwrap<PortalOrder>(
    request('/api/v1/portal/cart/checkout', { method: 'POST', data }),
  );
}

export async function listAddresses() {
  return unwrap<AddressRecord[]>(
    request('/api/v1/portal/addresses', { method: 'GET' }),
  );
}

export async function createAddress(data: Omit<AddressRecord, 'id'>) {
  return unwrap<AddressRecord>(
    request('/api/v1/portal/addresses', { method: 'POST', data }),
  );
}

export async function updateAddress(
  id: number,
  data: Partial<Omit<AddressRecord, 'id'>>,
) {
  return unwrap<AddressRecord>(
    request(`/api/v1/portal/addresses/${id}`, { method: 'PUT', data }),
  );
}

export async function setDefaultAddress(id: number) {
  return unwrap<AddressRecord>(
    request(`/api/v1/portal/addresses/${id}/default`, { method: 'POST' }),
  );
}

export async function deleteAddress(id: number) {
  return unwrap<null>(
    request(`/api/v1/portal/addresses/${id}`, { method: 'DELETE' }),
  );
}

// ---------------------------------------------------------------------------
// 财务中心：提现审核 / 结算批次（佣金规则已下线，比例改挂在商品与分类上）
// ---------------------------------------------------------------------------

export async function listPayouts(status?: string) {
  return unwrap<PayoutRecord[]>(
    request('/api/v1/admin/payouts', { method: 'GET', params: { status } }),
  );
}
export async function approvePayout(id: number) {
  return unwrap<PayoutRecord>(
    request(`/api/v1/admin/payouts/${id}/approve`, { method: 'POST' }),
  );
}

export async function rejectPayout(id: number, reason = '') {
  return unwrap<PayoutRecord>(
    request(`/api/v1/admin/payouts/${id}/reject`, { method: 'POST', data: { reason } }),
  );
}

export async function payPayout(id: number) {
  return unwrap<PayoutRecord>(
    request(`/api/v1/admin/payouts/${id}/pay`, { method: 'POST' }),
  );
}

export async function listSettlementBatches(params?: { status?: string }) {
  return unwrap<SettlementBatchRecord[]>(
    request('/api/v1/admin/settlement-batches', { method: 'GET', params }),
  );
}

export async function createSettlementBatch(data: {
  period_start: string;
  period_end: string;
  note?: string;
}) {
  return unwrap<SettlementBatchRecord>(
    request('/api/v1/admin/settlement-batches', { method: 'POST', data }),
  );
}

export async function confirmSettlementBatch(id: number) {
  return unwrap<SettlementBatchRecord>(
    request(`/api/v1/admin/settlement-batches/${id}/confirm`, { method: 'POST' }),
  );
}

export async function paySettlementBatch(id: number) {
  return unwrap<SettlementBatchRecord>(
    request(`/api/v1/admin/settlement-batches/${id}/pay`, { method: 'POST' }),
  );
}

/** 当前用户的开店状态：none / pending / active。 */
export interface SellerApplicationState {
  has_seller: boolean;
  status: string;
  seller_id?: number;
  display_name?: string;
  kyc_status?: string;
  shop?: { id: number; name: string; slug: string; status?: string } | null;
}

export async function getSellerApplication() {
  return unwrap<SellerApplicationState>(
    request('/api/v1/portal/seller/application', { method: 'GET' }),
  );
}

export async function applySeller(data: { shop_name: string; contact_phone?: string }) {
  return unwrap<SellerApplicationState>(
    request('/api/v1/portal/seller/apply', { method: 'POST', data }),
  );
}

/** 公开商品橱窗（无需登录）。字段与 Portal 展示一致。 */
export interface PublicProduct {
  id: number;
  seller_id: number;
  shop_id: number;
  name: string;
  description?: string | null;
  status: string;
  /** 商品类型（physical 等）；买家详情页显示标签 */
  product_type?: string;
  /** 交付方式：express / pickup（买家下单选交付方式时用） */
  delivery_methods?: string[];
  main_image?: string | null;
  images?: string[];
  video_url?: string | null;
  shop_name?: string;
  seller_name?: string;
  /** 富文本描述：format=doc 时用 html（服务端已清洗），否则回落到纯文本 description */
  description_format?: 'text' | 'doc';
  description_html?: string | null;
  // ---- 店铺信息卡（详情接口才有）----
  /** 店铺 logo：买家侧「头像」就用它（users 表没有头像字段） */
  shop_logo?: string | null;
  shop_description?: string | null;
  /** 卖家 owner 的用户名（买家侧只展示 username，不展示 usr_ 编号） */
  seller_username?: string | null;
  /** 全站名称（租户品牌名） */
  tenant_name?: string | null;
  sku?: { id: number; name: string; price_cents: number; stock: number } | null;
  /** 列表：可用 SKU 的起售价/最高价（多规格展示「¥xx 起」） */
  price_min_cents?: number | null;
  price_max_cents?: number | null;
  sku_count?: number;
  in_stock?: boolean;
  /** 详情接口才有：该商品的全部可用 SKU */
  skus?: Array<{
    id: number;
    sku_code: string;
    name: string;
    price_cents: number;
    stock: number;
    /** {规格组名: 规格值} */
    specs?: Record<string, string>;
    image_url?: string | null;
    video_url?: string | null;
  }>;
  /** 详情：规格树（多规格选择器） */
  spec_groups?: Array<{
    name: string;
    values: Array<{
      value: string;
      image_url?: string | null;
      video_url?: string | null;
    }>;
  }>;
  /** 列表卡片上的社会证明（与运营端、卖家端同一口径） */
  sold_count?: number;
  favorite_count?: number;
  rating_avg?: number | null;
  review_count?: number;
  /** 详情接口才有：浏览数（每次打开 +1）与当前用户是否已收藏 */
  view_count?: number;
  is_favorited?: boolean;
}

/**
 * 商品列表（公开）的筛选参数。
 *
 * 排序值都是语义 code，不暴露字段名：`default` 综合 / `sold_desc` 销量 /
 * `newest` 最新发布 / `price_asc` `price_desc` 价格。
 */
export interface PublicProductQuery {
  tenant?: string;
  /** 搜商品名 / 铺名 / 卖家名 / 卖家用户名 */
  keyword?: string;
  /** 只支持一级分类（平台级分类，全租户共用） */
  category_id?: number;
  /** 只看某个卖家的商品（IM 里发商品卡片时按会话卖家限定） */
  seller_id?: number;
  /** 价格区间（分）：按在售 SKU 的最低价筛 */
  min_price_cents?: number;
  max_price_cents?: number;
  sort?: 'default' | 'sold_desc' | 'newest' | 'price_asc' | 'price_desc';
  page?: number;
  page_size?: number;
}

export interface PublicProductPage {
  list: PublicProduct[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listPublicProducts(params?: PublicProductQuery) {
  return unwrap<PublicProductPage>(
    request('/api/v1/public/products', { method: 'GET', params }),
  );
}

/** 详情页「猜你喜欢」：相似商品分页流（同分类 → 同卖家 → 全站兜底）。 */
export async function listRelatedProducts(
  productId: number,
  params?: { page?: number; page_size?: number },
) {
  return unwrap<PublicProductPage>(
    request(`/api/v1/public/products/${productId}/related`, {
      method: 'GET',
      params,
    }),
  );
}

/** 买家端筛选用的分类（平台级、只一级）。 */
/** 省市区级联数据（内置行政区划，随仓库走，不依赖第三方服务）。 */
export async function getRegions() {
  return unwrap<Array<{ name: string; children?: Array<{ name: string; children?: Array<{ name: string }> }> }>>(
    request('/api/v1/public/regions', { method: 'GET' }),
  );
}

export async function listPublicCategories() {
  return unwrap<Array<{ id: number; name: string; slug: string }>>(
    request('/api/v1/public/categories', { method: 'GET' }),
  );
}

/** 公开商品详情（匿名可读，含全部 SKU）。 */
export async function getPublicProductDetail(id: number, params?: { tenant?: string }) {
  return unwrap<PublicProduct>(
    request(`/api/v1/public/products/${id}`, { method: 'GET', params }),
  );
}

/** 买家订单详情（需 order:read:self）。 */
export interface PortalOrderDetail {
  id: number;
  order_no: string;
  status: string;
  payable_amount_cents: number;
  seller_orders: Array<{ id: number; seller_id: number; status: string }>;
  items: Array<{
    product_name: string;
    sku_name: string;
    price_cents: number;
    quantity: number;
  }>;
}

export async function getPortalOrderDetail(id: number) {
  return unwrap<PortalOrderDetail>(
    request(`/api/v1/portal/orders/${id}`, { method: 'GET' }),
  );
}

/* ==================== 商品收藏 ====================
 * 四个视角走同一组函数命名：我 / 运营 / 卖家 / 平台。
 * 人物标识一律 `user_public_id` + `user_username`（全站硬规则）。
 */

/** 收藏（幂等，重复点不会报错）。 */
export async function addFavorite(productId: number) {
  return unwrap<{ is_favorited: boolean }>(
    request(`/api/v1/public/products/${productId}/favorite`, {
      method: 'POST',
    }),
  );
}

/** 取消收藏。 */
export async function removeFavorite(productId: number) {
  return unwrap<{ is_favorited: boolean }>(
    request(`/api/v1/public/products/${productId}/favorite`, {
      method: 'DELETE',
    }),
  );
}

/** 买家「我的收藏」。 */
export async function listMyFavorites() {
  return unwrap<FavoriteRecord[]>(
    request('/api/v1/portal/favorites', { method: 'GET' }),
  );
}

/** 运营视角：本租户全部收藏。 */
export async function listAdminFavorites(params?: {
  keyword?: string;
  product_id?: number;
}) {
  return unwrap<FavoriteRecord[]>(
    request('/api/v1/admin/favorites', { method: 'GET', params }),
  );
}

/** 卖家视角：自己店铺商品的收藏。 */
export async function listSellerFavorites(params?: { keyword?: string }) {
  return unwrap<FavoriteRecord[]>(
    request('/api/v1/portal/seller/favorites', { method: 'GET', params }),
  );
}

/* ==================== 商品评价 ====================
 * 买家侧只读 public 接口（匿名评价已脱敏）；
 * 运营/卖家侧读管理接口（匿名的也能看到真实 用户ID + 用户名）。
 */

/** 商品详情页的评价区（匿名可读）。 */
export async function getProductReviews(
  productId: number,
  params?: { limit?: number; offset?: number },
) {
  return unwrap<{
    list: PublicReview[];
    total: number;
    rating_avg: number | null;
    limit: number;
    offset: number;
  }>(
    request(`/api/v1/public/products/${productId}/reviews`, {
      method: 'GET',
      params,
    }),
  );
}

/** 提交评价（只能评自己已完成订单的订单项）。 */
export async function createReview(data: {
  order_item_id: number;
  rating: number;
  content?: string;
  media?: ReviewMedia[];
  is_anonymous?: boolean;
}) {
  return unwrap<{ id: number }>(
    request('/api/v1/portal/reviews', { method: 'POST', data }),
  );
}

/** 我写过的评价。 */
export async function listMyReviews() {
  return unwrap<ReviewRecord[]>(
    request('/api/v1/portal/reviews', { method: 'GET' }),
  );
}

/** 我还能评的订单项（已完成 + 未评过）。 */
export async function listReviewableItems() {
  return unwrap<
    Array<{
      order_item_id: number;
      order_id: number;
      product_id: number;
      product_name: string;
      sku_name: string;
      image?: string | null;
    }>
  >(request('/api/v1/portal/reviews/reviewable', { method: 'GET' }));
}

/** 运营视角：本租户全部评价。 */
export async function listAdminReviews(params?: {
  keyword?: string;
  status?: string;
  moderation_status?: string;
}) {
  return unwrap<ReviewRecord[]>(
    request('/api/v1/admin/reviews', { method: 'GET', params }),
  );
}

/** 运营：隐藏 / 恢复评价（需要 product:moderate）。 */
export async function setAdminReviewStatus(id: number, status: string) {
  return unwrap<{ id: number; status: string }>(
    request(`/api/v1/admin/reviews/${id}/status`, {
      method: 'POST',
      data: { status },
    }),
  );
}

/** 运营：回复评价。 */
export async function replyAdminReview(id: number, reply: string) {
  return unwrap<{ id: number; reply: string }>(
    request(`/api/v1/admin/reviews/${id}/reply`, {
      method: 'POST',
      data: { reply },
    }),
  );
}

/** 卖家视角：自己商品收到的评价。 */
export async function listSellerReviews(params?: {
  keyword?: string;
  status?: string;
}) {
  return unwrap<ReviewRecord[]>(
    request('/api/v1/portal/seller/reviews', { method: 'GET', params }),
  );
}

/** 卖家：只能回复，不能隐藏（隐藏只有运营/平台能做）。 */
export async function replySellerReview(id: number, reply: string) {
  return unwrap<{ id: number; reply: string }>(
    request(`/api/v1/portal/seller/reviews/${id}/reply`, {
      method: 'POST',
      data: { reply },
    }),
  );
}
