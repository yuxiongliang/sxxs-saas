/** 租户控制台枚举值的中文文案（与平台端各留一份，两个 app 独立部署）。 */

export const PRODUCT_STATUS: Record<string, string> = {
  draft: '草稿',
  pending_review: '待审核',
  on_sale: '在售',
  off_sale: '已下架',
  rejected: '已驳回',
};

/**
 * 商品类型。**只有 physical 已开放**，其余三类在下单/发货/库存上还没打通，
 * 界面上要显示但选不了（带「待开发」标记）。
 * 类型创建后不可修改 —— 改了会让已有订单、库存、发货语义断层。
 */
export const PRODUCT_TYPE: Record<string, string> = {
  physical: '实物商品',
  virtual: '虚拟商品',
  knowledge: '知识付费',
  event: '活动报名',
};

/** 已开放的类型：前端"能不能选"和后端"能不能写"以这个为准 */
export const OPEN_PRODUCT_TYPES = ['physical'];

export const PRODUCT_TYPE_COLOR: Record<string, string> = {
  physical: 'blue',
  virtual: 'default',
  knowledge: 'default',
  event: 'default',
};

/**
 * 支付状态（钱的事）。
 *
 * 与履约状态拆开：以前一个 `status` 同时表达「付没付钱」和「发没发货」，
 * 想筛「已支付未发货」根本筛不出来。
 */
export const PAYMENT_STATUS: Record<string, string> = {
  unpaid: '待支付',
  paid: '已支付',
  refunding: '退款中',
  partially_refunded: '部分退款',
  refunded: '已退款',
  // 与履行状态同一口径：取消 = 关闭（两列说法必须一致，否则同一单自相矛盾）
  cancelled: '已关闭',
};

export const PAYMENT_STATUS_COLOR: Record<string, string> = {
  unpaid: 'gold',
  paid: 'blue',
  refunding: 'orange',
  partially_refunded: 'orange',
  refunded: 'red',
  cancelled: 'default',
};

/** 履约状态（货的事）。产品口径：不要「部分发货」，多卖家单部分发货也显示「已发货」。 */
export const FULFILLMENT_STATUS: Record<string, string> = {
  awaiting_payment: '待付款',
  to_ship: '待发货',
  shipped: '已发货',
  completed: '已完成',
  // 产品口径：取消/全额退款都叫「已关闭」
  cancelled: '已关闭',
};

export const FULFILLMENT_STATUS_COLOR: Record<string, string> = {
  awaiting_payment: 'gold',
  to_ship: 'blue',
  shipped: 'geekblue',
  completed: 'green',
  cancelled: 'default',
};

/** 交付方式：实物商品的配送方式，一个卖家单一种。 */
export const DELIVERY_METHOD: Record<string, string> = {
  express: '物流快递',
  pickup: '自提',
};

/** 交付方式多选（商品维度）：勾选项与文案。 */
export const DELIVERY_METHOD_OPTIONS = [
  {
    value: 'express',
    label: '物流快递',
    desc: '买家下单 → 卖家填运单号发货 → 7 天自动收货 → 完成（完成后不再受理售后）',
  },
  {
    value: 'pickup',
    label: '自提',
    desc: '买家下单 → 卖家备货完成 → 买家到场确认自提 → 完成（90 天未确认自动完成，完成后不再受理售后）',
  },
];

export const ORDER_STATUS: Record<string, string> = {
  pending_payment: '待支付',
  paid: '已支付',
  processing: '处理中',
  partially_shipped: '部分发货',
  shipped: '已发货',
  completed: '已完成',
  cancelled: '已取消',
  refunding: '退款中',
  refunded: '已退款',
  closed: '已关闭',
};

export const SELLER_STATUS: Record<string, string> = {
  pending: '待审核',
  active: '正常',
  suspended: '已停用',
  closed: '已关闭',
};

export const KYC_STATUS: Record<string, string> = {
  none: '未提交',
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
};

export const PAYOUT_STATUS: Record<string, string> = {
  pending: '待处理',
  approved: '已批准',
  rejected: '已驳回',
  paid: '已打款',
};

export const BATCH_STATUS: Record<string, string> = {
  draft: '草稿',
  confirmed: '已确认',
  paid: '已打款',
};

export const ACTIVITY_STATUS: Record<string, string> = {
  active: '启用',
  archived: '已停用',
  disabled: '已停用',
};

export const labelOf = (
  dict: Record<string, string>,
  value?: string | null,
): string => {
  if (value === null || value === undefined || value === '') return '—';
  return dict[value] ?? value;
};
