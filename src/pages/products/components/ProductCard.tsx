import {
  EnvironmentOutlined,
  ShoppingCartOutlined,
  ShoppingOutlined,
} from '@ant-design/icons';
import { useModel } from '@umijs/max';
import { App, Button, Card, Tag } from 'antd';
import type { PublicProduct } from '@/services/commerce/api';
import { addCartItem } from '@/services/commerce/api';
import { formatDistance } from '@/utils/distance';

function yuan(cents: number) {
  return (cents / 100).toFixed(2);
}

/**
 * 商品卡片：站点前台的统一展示单元。
 *
 * 三种版式（`variant`）：
 * * `default` —— **封面 1:1** + 两个按钮，用于栅格场景（首页精选等）
 * * `masonry` —— **封面按图片原始比例**，卡片高度天然不等，瀑布流才有「错开」效果
 *   （`max-height` 兜底，防一张超长图把整列拉爆），标题允许 2 行
 * * `compact` —— 瀑布流 + 去掉按钮（详情页「猜你喜欢」的窄列放不下两个按钮）
 *
 * 不变的三条：不展示店铺/卖家；没有「查看详情」按钮（整卡可点 + 键盘 Enter/Space）；
 * 展示已售 / 浏览。
 */
export default function ProductCard({
  product,
  variant = 'default',
}: {
  product: PublicProduct;
  variant?: 'default' | 'masonry' | 'compact';
}) {
  const { message } = App.useApp();
  const { initialState } = useModel('@@initialState');
  const signedIn = Boolean(initialState?.currentUser);

  const detailPath = `/products/${product.id}`;
  const multiSpec = (product.sku_count ?? 0) > 1;
  const inStock = product.in_stock ?? (product.sku?.stock ?? 0) > 0;
  const priceMin = product.price_min_cents ?? product.sku?.price_cents ?? 0;
  const priceMax = product.price_max_cents ?? priceMin;
  const isMasonry = variant !== 'default';
  const showActions = variant !== 'compact';

  /** 未登录就带去登录页，登录后回到该商品详情 */
  const ensureSignedIn = () => {
    if (signedIn) return true;
    window.location.assign(
      `/user/login?redirect=${encodeURIComponent(detailPath)}`,
    );
    return false;
  };

  const openDetail = () => {
    window.location.assign(detailPath);
  };

  const handleAddCart = async () => {
    // 多规格不能从列表卡直接加购：买家没选规格就下单，语义不成立
    if (multiSpec) {
      openDetail();
      return;
    }
    const sku = product.sku;
    if (!ensureSignedIn() || !sku) return;
    try {
      await addCartItem({ sku_id: sku.id, quantity: 1 });
      message.success('已加入购物车');
    } catch (error) {
      message.error((error as Error)?.message || '加入购物车失败');
    }
  };

  const handleBuyNow = () => {
    if (!ensureSignedIn()) return;
    // 立即购买要填收货信息，交给详情页处理（?buy=1 自动滚到购买区）
    window.location.assign(`${detailPath}?buy=1`);
  };

  return (
    <Card
      hoverable
      data-testid={`product-card-${product.id}`}
      styles={{ body: { padding: 12 } }}
      onClick={openDetail}
      onKeyDown={(event) => {
        // 整卡可点也必须能用键盘打开，否则只剩鼠标通路
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openDetail();
        }
      }}
      tabIndex={0}
      role="link"
      aria-label={`查看商品 ${product.name}`}
      cover={
        product.main_image ? (
          <img
            src={product.main_image}
            alt={product.name}
            data-testid="product-card-cover"
            style={{
              width: '100%',
              // 瀑布流：按图片原始比例（+ maxHeight 兜底），卡片高度才会错开
              ...(isMasonry
                ? {
                    height: 'auto' as const,
                    maxHeight: 420,
                    objectFit: 'cover' as const,
                  }
                : { aspectRatio: '1 / 1', objectFit: 'cover' as const }),
              display: 'block',
            }}
          />
        ) : (
          <div
            data-testid="product-card-cover"
            style={{
              width: '100%',
              ...(isMasonry ? { height: 180 } : { aspectRatio: '1 / 1' }),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 40,
              color: 'var(--ant-color-primary)',
              background:
                'linear-gradient(135deg, var(--ant-color-primary-bg), var(--ant-color-fill-secondary))',
            }}
          >
            <ShoppingOutlined />
          </div>
        )
      }
    >
      <div
        data-testid="product-card-title"
        style={{
          fontWeight: 600,
          marginBottom: 4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          ...(isMasonry
            ? {
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical' as const,
                minHeight: 44,
              }
            : { whiteSpace: 'nowrap' as const }),
        }}
      >
        {product.name}
      </div>

      <div
        style={{
          marginTop: 8,
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            color: 'var(--ant-color-error)',
            fontSize: 18,
            fontWeight: 700,
          }}
        >
          ¥{yuan(priceMin)}
          {multiSpec && priceMax > priceMin ? ' 起' : ''}
        </span>
        <Tag
          color={inStock ? 'green' : 'default'}
          style={{ marginInlineEnd: 0 }}
        >
          {inStock
            ? multiSpec
              ? `${product.sku_count} 种规格`
              : '有货'
            : '已售罄'}
        </Tag>
      </div>

      {/* 热度：销量 + 浏览。浏览=详情页 PV，与后台列头口径一致 */}
      <div
        data-testid="product-card-stats"
        style={{
          marginTop: 6,
          fontSize: 12,
          opacity: 0.65,
          display: 'flex',
          gap: 12,
        }}
      >
        <span>已售 {product.sold_count ?? 0}</span>
        <span>浏览 {product.view_count ?? 0}</span>
        {/* 距离/地名：服务端算好 distance_m；没定位就只显示「省 市」 */}
        {product.distance_m !== null &&
        product.distance_m !== undefined &&
        formatDistance(product.distance_m) ? (
          <span data-testid="product-card-distance">
            <EnvironmentOutlined /> 距您 {formatDistance(product.distance_m)}
          </span>
        ) : product.location ? (
          <span data-testid="product-card-location">
            <EnvironmentOutlined /> {product.location}
          </span>
        ) : null}
      </div>

      {showActions ? (
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 12,
            // 关键：允许收缩，按钮不撑破卡片
            minWidth: 0,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <Button
            data-testid="card-add-cart"
            icon={<ShoppingCartOutlined />}
            style={{ flex: '1 1 0', minWidth: 0 }}
            onClick={handleAddCart}
          >
            加入购物车
          </Button>
          <Button
            data-testid="card-buy-now"
            type="primary"
            style={{ flex: '1 1 0', minWidth: 0 }}
            onClick={handleBuyNow}
          >
            立即购买
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
