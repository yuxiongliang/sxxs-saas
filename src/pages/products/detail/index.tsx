import { ShoppingOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIntl, useNavigate, useParams } from '@umijs/max';
import {
  App,
  Button,
  Card,
  Col,
  Empty,
  InputNumber,
  Row,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import RichTextViewer from '@/components/RichTextViewer';
import {
  isComboComplete,
  isSellable,
  resolveMedia,
} from '@/pages/commerce/products/components/specUtils';
import useStyles from '@/pages/site/style';
import {
  addCartItem,
  addFavorite,
  getPublicProductDetail,
  removeFavorite,
} from '@/services/commerce/api';
import MallShell from '../components/MallShell';
import ReviewsPanel from './ReviewsPanel';
import ShopCard from './ShopCard';

const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

/**
 * 商品详情（站点前台，公开浏览）。
 *
 * 从原 `/portal/products/:id` 迁出：浏览不需要登录，
 * 只有「加入购物车 / 立即购买」需要，未登录时引导登录并回到本页。
 */
export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const productId = Number(id);
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { styles } = useStyles();
  const { formatMessage: t } = useIntl();
  const queryClient = useQueryClient();

  const [skuId, setSkuId] = useState<number>();
  const [quantity, setQuantity] = useState(1);
  // 多规格：每个规格组选中的值（未选全 = 还没确定 SKU）
  const [selected, setSelected] = useState<Record<string, string>>({});

  const { data, isLoading, isError } = useQuery({
    queryKey: ['public-product-detail', productId],
    queryFn: () => getPublicProductDetail(productId),
    enabled: Number.isFinite(productId),
  });

  const specGroups = data?.spec_groups ?? [];
  const hasSpecs = specGroups.length > 0;

  const activeSku = useMemo(() => {
    if (!data?.skus?.length) return data?.sku ?? undefined;
    if (!hasSpecs) {
      return data.skus.find((item) => item.id === skuId) ?? data.skus[0];
    }
    // 规格未选全就不确定 SKU（不能默默拿第一条去下单）
    if (!isComboComplete(specGroups, selected)) return undefined;
    return data.skus.find((item) =>
      specGroups.every(
        (group) => item.specs?.[group.name] === selected[group.name],
      ),
    );
  }, [data, skuId, hasSpecs, specGroups, selected]);

  // 切规格后数量可能超过新 SKU 库存，得裁回去，否则后端 409
  useEffect(() => {
    if (!activeSku) return;
    const max = Math.max(1, activeSku.stock);
    setQuantity((prev) => Math.min(prev, max));
  }, [activeSku]);

  const pickSpec = (groupName: string, value: string) => {
    setSelected((prev) => ({ ...prev, [groupName]: value }));
  };

  // 与卖家端同一套取图优先级：SKU 覆盖图 > 规格值图 > 商品主图
  const media = resolveMedia({
    skuImage: data?.skus?.find((item) => item.id === activeSku?.id)?.image_url,
    skuVideo: data?.skus?.find((item) => item.id === activeSku?.id)?.video_url,
    groups: specGroups,
    selected,
    mainImage: data?.main_image,
  });
  const skuImage = media?.url ?? '';

  const loginPath = `/user/login?redirect=${encodeURIComponent(`/products/${productId}`)}`;

  const requireLogin = async () => {
    try {
      // 用一个轻量鉴权探测判断登录态：未登录时 queryMe 会 401 并被拦截器带到这里
      const { me } = await import('@/services/auth/api');
      await me();
      return true;
    } catch {
      window.location.assign(loginPath);
      return false;
    }
  };

  const addToCart = async () => {
    if (!activeSku) return;
    if (!(await requireLogin())) return;
    try {
      await addCartItem({ sku_id: activeSku.id, quantity });
      message.success(
        t({ id: 'product.detail.addedCart', defaultMessage: '已加入购物车' }),
      );
    } catch (error) {
      message.error((error as Error)?.message || '加入购物车失败');
    }
  };

  const buyNow = async () => {
    if (!activeSku) return;
    if (!(await requireLogin())) return;
    try {
      await addCartItem({ sku_id: activeSku.id, quantity });
      navigate('/portal/cart');
    } catch (error) {
      message.error((error as Error)?.message || '下单失败');
    }
  };

  const outOfStock = Boolean(activeSku) && (activeSku?.stock ?? 0) <= 0;
  const needPickSpec = hasSpecs && !activeSku;

  // ---- 收藏 ----
  // 状态来自详情接口的 `is_favorited`（带 token 时才有），本地只是乐观同步
  const [favorited, setFavorited] = useState(false);
  const [favoriting, setFavoriting] = useState(false);
  useEffect(() => {
    setFavorited(Boolean(data?.is_favorited));
  }, [data?.is_favorited]);

  const toggleFavorite = async () => {
    if (!(await requireLogin())) return;
    setFavoriting(true);
    try {
      const result = favorited
        ? await removeFavorite(productId)
        : await addFavorite(productId);
      setFavorited(result.is_favorited);
      message.success(result.is_favorited ? '已收藏' : '已取消收藏');
      queryClient.invalidateQueries({
        queryKey: ['public-product-detail', productId],
      });
    } catch (error) {
      message.error((error as Error)?.message || '操作失败');
    } finally {
      setFavoriting(false);
    }
  };

  return (
    <MallShell activeKey="products">
      <section className={styles.section}>
        <div className={styles.container}>
          {isLoading ? (
            <Card>
              <Skeleton active />
            </Card>
          ) : isError || !data ? (
            <Empty
              description={
                <div>
                  <div>
                    {t({
                      id: 'product.detail.notFound',
                      defaultMessage: '商品不存在或已下架',
                    })}
                  </div>
                  {/* 死胡同页面必须给出路：直接返回可浏览的列表 */}
                  <Button
                    type="primary"
                    style={{ marginTop: 12 }}
                    onClick={() => navigate('/products')}
                  >
                    返回商品列表
                  </Button>
                </div>
              }
            />
          ) : (
            <Row gutter={[24, 24]}>
              {/* 主图：正方形 1:1（与列表卡片同一口径），不再写死 320px */}
              <Col xs={24} md={9} lg={8}>
                <Card
                  styles={{ body: { padding: 0 } }}
                  cover={
                    skuImage ? (
                      <img
                        src={skuImage}
                        alt={data.name}
                        data-testid="product-cover"
                        style={{
                          width: '100%',
                          aspectRatio: '1 / 1',
                          objectFit: 'cover',
                          display: 'block',
                        }}
                      />
                    ) : (
                      <div
                        data-testid="product-cover"
                        style={{
                          width: '100%',
                          aspectRatio: '1 / 1',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 72,
                          color: 'var(--ant-color-primary)',
                          background:
                            'linear-gradient(135deg, var(--ant-color-primary-bg), var(--ant-color-fill-secondary))',
                        }}
                      >
                        <ShoppingOutlined />
                      </div>
                    )
                  }
                />
              </Col>
              <Col xs={24} md={9} lg={10}>
                <Card>
                  <Typography.Title level={3} style={{ marginTop: 0 }}>
                    {data.name}
                  </Typography.Title>
                  <Space
                    orientation="vertical"
                    size={14}
                    style={{ width: '100%' }}
                  >
                    {/* 副标题已全站下线，不再展示 */}
                    <div
                      style={{
                        color: 'var(--ant-color-error)',
                        fontSize: 28,
                        fontWeight: 700,
                      }}
                    >
                      {yuan(activeSku?.price_cents ?? 0)}
                    </div>

                    <Space size={8} wrap>
                      {/* 「卖家 / 店铺」两个 Tag 已移到右侧店铺卡，这里不再重复展示 */}
                      <Tag color={outOfStock ? 'red' : 'green'}>
                        {t(
                          {
                            id: 'mall.product.stock',
                            defaultMessage: '库存 {count}',
                          },
                          { count: activeSku?.stock ?? 0 },
                        )}
                      </Tag>
                      {/* 社会证明：已售 / 收藏 / 评分，与运营端同一口径 */}
                      <Tag>
                        已售 {data.sold_count ?? 0} 件 ·{' '}
                        {data.favorite_count ?? 0} 人收藏
                      </Tag>
                      {data.rating_avg != null ? (
                        <Tag color="orange">
                          ★ {data.rating_avg.toFixed(1)}（
                          {data.review_count ?? 0}）
                        </Tag>
                      ) : null}
                    </Space>

                    {hasSpecs ? (
                      <Space
                        orientation="vertical"
                        size={10}
                        style={{ width: '100%' }}
                      >
                        {specGroups.map((group) => (
                          <Space
                            key={group.name}
                            size={8}
                            wrap
                            data-testid="spec-group"
                          >
                            <Typography.Text type="secondary">
                              {group.name}：
                            </Typography.Text>
                            {group.values.map((value) => {
                              // 同一组下其它值是否还会形成可售组合（不会则置灰）
                              const candidate = {
                                ...selected,
                                [group.name]: value.value,
                              };
                              const sellable = isSellable(
                                data.skus ?? [],
                                specGroups,
                                candidate,
                              );
                              return (
                                <Button
                                  key={value.value}
                                  size="small"
                                  data-testid={`spec-value-${value.value}`}
                                  disabled={!sellable}
                                  type={
                                    selected[group.name] === value.value
                                      ? 'primary'
                                      : 'default'
                                  }
                                  onClick={() =>
                                    pickSpec(group.name, value.value)
                                  }
                                >
                                  {value.value}
                                </Button>
                              );
                            })}
                          </Space>
                        ))}
                        {needPickSpec ? (
                          <Typography.Text type="warning">
                            请先选择完整的规格，才能加入购物车
                          </Typography.Text>
                        ) : null}
                      </Space>
                    ) : (data.skus?.length ?? 0) > 1 ? (
                      <Space size={8} wrap>
                        <Typography.Text>
                          {t({
                            id: 'product.detail.spec',
                            defaultMessage: '规格',
                          })}
                          ：
                        </Typography.Text>
                        {(data.skus ?? []).map((sku) => (
                          <Button
                            key={sku.id}
                            type={
                              activeSku?.id === sku.id ? 'primary' : 'default'
                            }
                            onClick={() => setSkuId(sku.id)}
                          >
                            {sku.name}
                          </Button>
                        ))}
                      </Space>
                    ) : null}

                    <Space size={8}>
                      <Typography.Text>
                        {t({
                          id: 'product.detail.quantity',
                          defaultMessage: '数量',
                        })}
                        ：
                      </Typography.Text>
                      <InputNumber
                        min={1}
                        max={Math.max(1, activeSku?.stock ?? 1)}
                        value={quantity}
                        onChange={(value) => setQuantity(value ?? 1)}
                      />
                    </Space>

                    <Space size={12}>
                      <Button
                        type="primary"
                        size="large"
                        data-testid="buy-now"
                        disabled={outOfStock || needPickSpec}
                        onClick={buyNow}
                      >
                        {t({
                          id: 'product.detail.buyNow',
                          defaultMessage: '立即购买',
                        })}
                      </Button>
                      <Button
                        size="large"
                        data-testid="add-to-cart"
                        disabled={outOfStock || needPickSpec}
                        onClick={addToCart}
                      >
                        {t({
                          id: 'product.detail.addCart',
                          defaultMessage: '加入购物车',
                        })}
                      </Button>
                      {/* 收藏：未登录先引导登录（收藏必须落到人头上，不能只改本地状态） */}
                      <Button
                        size="large"
                        data-testid="favorite-toggle"
                        icon={favorited ? <StarFilled /> : <StarOutlined />}
                        loading={favoriting}
                        onClick={toggleFavorite}
                      >
                        {favorited ? '已收藏' : '收藏'}
                      </Button>
                    </Space>
                  </Space>
                </Card>
              </Col>
              {/* 店铺信息卡：头像/用户名/全站名称/在线客服/进店逛逛 */}
              <Col xs={24} md={6}>
                <div style={{ position: 'sticky', top: 16 }}>
                  <ShopCard product={data} />
                </div>
              </Col>
            </Row>
          )}
          {/* 商品详情（富文本）：全宽卡片。表格/图片很多，挤在信息列里根本展不开 */}
          {!isLoading && !isError && data ? (
            <Card
              title={t({
                id: 'product.detail.descriptionTitle',
                defaultMessage: '商品详情',
              })}
              style={{ marginTop: 16 }}
            >
              {data.description_format === 'doc' && data.description_html ? (
                <RichTextViewer
                  html={data.description_html}
                  fallback={
                    <Typography.Text type="secondary">
                      {t({
                        id: 'product.detail.noDescription',
                        defaultMessage: '卖家暂未填写商品描述。',
                      })}
                    </Typography.Text>
                  }
                />
              ) : data.description ? (
                // 老商品仍是纯文本：保留换行，不要挤成一团
                <Typography.Paragraph
                  style={{ whiteSpace: 'pre-line', marginBottom: 0 }}
                >
                  {data.description}
                </Typography.Paragraph>
              ) : (
                <Typography.Text type="secondary">
                  {t({
                    id: 'product.detail.noDescription',
                    defaultMessage: '卖家暂未填写商品描述。',
                  })}
                </Typography.Text>
              )}
            </Card>
          ) : null}
          {/* 评价区：只展示 visible；匿名的已脱敏（见 public_reviews） */}
          {!isLoading && !isError ? (
            <ReviewsPanel productId={productId} />
          ) : null}
        </div>
      </section>
    </MallShell>
  );
}
