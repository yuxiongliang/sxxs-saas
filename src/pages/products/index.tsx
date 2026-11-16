import { useQuery } from '@tanstack/react-query';
import { useIntl, useSearchParams } from '@umijs/max';
import { Col, Empty, Pagination, Row, Spin } from 'antd';
import { useCallback, useMemo } from 'react';
import useStyles from '@/pages/site/style';
import { listPublicProducts } from '@/services/commerce/api';
import type { ProductFilters } from './components/FilterBar';
import FilterBar from './components/FilterBar';
import MallShell from './components/MallShell';
import ProductCard from './components/ProductCard';

const PAGE_SIZE = 20;

const SORTS = [
  'default',
  'sold_desc',
  'newest',
  'price_asc',
  'price_desc',
] as const;
type SortValue = (typeof SORTS)[number];

function parseNumber(value: string | null): number | undefined {
  if (value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * 商品列表（站点前台，公开浏览）。
 *
 * **筛选条件全部落在 URL 上**（`?keyword=&category=&min=&max=&sort=&page=`）：
 * 刷新不丢、能分享给朋友、浏览器返回到上一页时筛选还在。
 * 页面本身不存筛选 state —— 只从 URL 读、改 URL，避免两处状态打架。
 */
export default function ProductsPage() {
  const { styles } = useStyles();
  const { formatMessage: t } = useIntl();
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: ProductFilters = useMemo(() => {
    const sort = searchParams.get('sort');
    return {
      keyword: searchParams.get('keyword') || undefined,
      categoryId: parseNumber(searchParams.get('category')),
      minPrice: parseNumber(searchParams.get('min')),
      maxPrice: parseNumber(searchParams.get('max')),
      sort: (SORTS as readonly string[]).includes(sort ?? '')
        ? (sort as SortValue)
        : 'default',
    };
  }, [searchParams]);

  const page = Math.max(1, parseNumber(searchParams.get('page')) ?? 1);

  /** 改筛选一律回第 1 页：否则「第 3 页 + 筛完只剩 1 页」会看到空列表 */
  const patchFilters = useCallback(
    (patch: Partial<ProductFilters>) => {
      const next = new URLSearchParams(searchParams);
      const write = (key: string, value: string | number | undefined) => {
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, String(value));
      };
      if ('keyword' in patch) write('keyword', patch.keyword);
      if ('categoryId' in patch) write('category', patch.categoryId);
      if ('minPrice' in patch) write('min', patch.minPrice);
      if ('maxPrice' in patch) write('max', patch.maxPrice);
      if ('sort' in patch) {
        if (!patch.sort || patch.sort === 'default') next.delete('sort');
        else next.set('sort', patch.sort);
      }
      next.delete('page');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const resetFilters = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [setSearchParams]);

  const productsQuery = useQuery({
    queryKey: ['public-products', filters, page],
    queryFn: () =>
      listPublicProducts({
        keyword: filters.keyword,
        category_id: filters.categoryId,
        // 用户按「元」输入，接口按「分」过滤
        min_price_cents:
          filters.minPrice === undefined ? undefined : filters.minPrice * 100,
        max_price_cents:
          filters.maxPrice === undefined ? undefined : filters.maxPrice * 100,
        sort: filters.sort,
        page,
        page_size: PAGE_SIZE,
      }),
    staleTime: 30_000,
  });

  const products = productsQuery.data?.list ?? [];
  const total = productsQuery.data?.total ?? 0;

  return (
    <MallShell activeKey="products">
      <section className={styles.section}>
        <div className={styles.container}>
          {/* 标题区块已按要求删除；件数移进筛选栏右侧，不丢信息也不占一整块 */}
          <FilterBar
            filters={filters}
            onChange={patchFilters}
            onReset={resetFilters}
            total={total}
            loading={productsQuery.isLoading}
          />

          {productsQuery.isLoading ? (
            <div style={{ padding: 64, textAlign: 'center' }}>
              <Spin />
            </div>
          ) : productsQuery.isError ? (
            <Empty
              description={t({
                id: 'mall.products.error',
                defaultMessage: '商品加载失败，请稍后重试',
              })}
            />
          ) : products.length === 0 ? (
            <Empty
              description={t({
                id: 'mall.products.empty',
                defaultMessage: '暂时还没有在售商品',
              })}
            />
          ) : (
            <>
              <Row gutter={[16, 16]}>
                {products.map((item) => (
                  <Col xs={24} sm={12} lg={8} xl={6} key={item.id}>
                    <ProductCard product={item} />
                  </Col>
                ))}
              </Row>
              {total > PAGE_SIZE ? (
                <Pagination
                  style={{ marginTop: 24, textAlign: 'center' }}
                  current={page}
                  pageSize={PAGE_SIZE}
                  total={total}
                  showSizeChanger={false}
                  onChange={(nextPage) => {
                    const next = new URLSearchParams(searchParams);
                    if (nextPage <= 1) next.delete('page');
                    else next.set('page', String(nextPage));
                    setSearchParams(next);
                    // 翻页后回到列表顶部，否则停在页面底部看不到新内容
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />
              ) : null}
            </>
          )}
        </div>
      </section>
    </MallShell>
  );
}
