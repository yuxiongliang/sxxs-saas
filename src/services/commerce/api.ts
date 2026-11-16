import { request } from '@umijs/max';
import type { ApiResponse } from '@/services/system/types';
import type {
  AddressRecord,
  CategoryRecord,
  CartItemRecord,
  CartSummary,
  OrderDetail,
  OrderRecord,
  PortalOrder,
  PortalProduct,
  PortalProductDetail,
  PayoutRecord,
  ProductRecord,
  ProductSkuRecord,
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

export async function listSellerProducts() {
  return unwrap<SellerProductRecord[]>(
    request('/api/v1/portal/seller/products', { method: 'GET' }),
  );
}

export async function createSellerProduct(data: {
  name: string;
  subtitle?: string;
  price_cents: number;
  stock: number;
}) {
  return unwrap<{ id: number; name: string; status: string }>(
    request('/api/v1/portal/seller/products', { method: 'POST', data }),
  );
}

/** 卖家改自己的商品：在售商品改内容/改价会自动打回待审核。 */
export async function updateSellerProduct(
  id: number,
  data: {
    name?: string;
    subtitle?: string;
    description?: string;
    main_image?: string;
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

export async function shipMySellerOrder(
  id: number,
  data: { carrier: string; tracking_no: string },
) {
  return unwrap<{ id: number; status: string }>(
    request(`/api/v1/portal/seller/orders/${id}/ship`, { method: 'POST', data }),
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

export async function mockPayPortalOrder(id: number) {
  return unwrap<{ id: number; status: string }>(
    request(`/api/v1/portal/orders/${id}/mock-pay`, { method: 'POST' }),
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
    subtitle?: string;
    description?: string;
    main_image?: string;
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

/** 保存规格树：规格值做笛卡尔积生成 SKU（后端按组合键匹配，老组合保留价/库存）。 */
export async function updateAdminProductSpecs(
  id: number,
  data: {
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
  },
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

export async function listAdminOrders(params?: { keyword?: string; status?: string }) {
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
// 买家商城：商品详情 / 购物车 / 地址簿
// ---------------------------------------------------------------------------

export async function getPortalProductDetail(id: number) {
  return unwrap<PortalProductDetail>(
    request(`/api/v1/portal/products/${id}`, { method: 'GET' }),
  );
}

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
  receiver_name: string;
  receiver_phone: string;
  receiver_address: Record<string, string>;
  address_id?: number;
  remark?: string;
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
  subtitle?: string | null;
  description?: string | null;
  status: string;
  main_image?: string | null;
  images?: string[];
  video_url?: string | null;
  shop_name?: string;
  seller_name?: string;
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
}

export async function listPublicProducts(params?: { tenant?: string; limit?: number }) {
  return unwrap<PublicProduct[]>(
    request('/api/v1/public/products', { method: 'GET', params }),
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
