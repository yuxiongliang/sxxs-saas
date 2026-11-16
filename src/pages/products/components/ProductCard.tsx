import { ShoppingCartOutlined, ShoppingOutlined } from '@ant-design/icons';
import { useModel } from '@umijs/max';
import { App, Button, Card, Tag, Typography } from 'antd';
import type { PublicProduct } from '@/services/commerce/api';
import { addCartItem } from '@/services/commerce/api';

const { Text } = Typography;

function yuan(cents: number) {
  return (cents / 100).toFixed(2);
}

/**
 * 商品卡片：站点前台的统一展示单元。
 *
 * 版式约束（按需求）：
 * * 封面**正方形（1:1）**，有图裁切填满，无图用渐变 + 图标占位，高度不随商品变；
 * * **不展示店铺/卖家**那一行 —— 卡片只讲商品本身；
 * * **没有「查看详情」按钮** —— 整张卡片就是入口（同时支持键盘 Enter/Space）；
 * * 展示**销量 / 浏览**，让买家一眼看出热度；
 * * 底部按钮 `flex: 1 1 0; min-width: 0`，两枚按钮均分容器，窄屏也不会溢出。
 *
 * 登录策略：加购 / 立即购买需要登录，未登录跳登录并带 redirect 回到本商品。
 */
export default function ProductCard({ product }: { product: PublicProduct }) {
  const { message } = App.useApp();
  const { initialState } = useModel('@@initialState');
  const signedIn = Boolean(initialState?.currentUser);

  const detailPath = `/products/${product.id}`;
  const multiSpec = (product.sku_count ?? 0) > 1;
  const inStock = product.in_stock ?? (product.sku?.stock ?? 0) > 0;
  const priceMin = product.price_min_cents ?? product.sku?.price_cents ?? 0;
  const priceMax = product.price_max_cents ?? priceMin;

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
              aspectRatio: '1 / 1',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : (
          <div
            data-testid="product-card-cover"
            style={{
              width: '100%',
              aspectRatio: '1 / 1',
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
          whiteSpace: 'nowrap',
        }}
      >
        {product.name}
      </div>
      <Text
        type="secondary"
        style={{ fontSize: 12, display: 'block', height: 20 }}
        ellipsis
      >
        {product.subtitle || '—'}
      </Text>

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
      </div>

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
    </Card>
  );
}
