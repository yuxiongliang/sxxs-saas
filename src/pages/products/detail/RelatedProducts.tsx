import { useInfiniteQuery } from '@tanstack/react-query';
import { Empty, Spin, Typography } from 'antd';
import { useEffect, useRef } from 'react';
import { listRelatedProducts } from '@/services/commerce/api';
import { splitIntoColumns } from '../components/masonry';
import ProductCard from '../components/ProductCard';

const PAGE_SIZE = 12;

/**
 * 详情页左侧「猜你喜欢」：**竖向瀑布流 + 区块内滚动无限加载**。
 *
 * 三条关键点：
 * 1. 桌面端（≥lg）是 `sticky` + 区块内独立滚动条 —— 用户在这个区块里滚就继续加载；
 *    窄屏取消 sticky/内滚，改为跟随页面滚动加载（避免双滚动条在手机上互相打架）。
 * 2. `IntersectionObserver` 的 `root` 必须**绑定到这个滚动容器**，否则在 `overflow:auto`
 *    的容器里，哨兵永远不会「进入视口」——这是内部滚动场景最常见的坑。
 * 3. 两列小卡：用同一套 `splitIntoColumns` 横向优先分配，和列表页瀑布流一个规则。
 */
export default function RelatedProducts({
  productId,
  enabled = true,
}: {
  productId: number;
  /** 商品不存在/下架时不要发请求 */
  enabled?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const query = useInfiniteQuery({
    queryKey: ['related-products', productId],
    enabled: enabled && Number.isFinite(productId),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      listRelatedProducts(productId, {
        page: pageParam as number,
        page_size: PAGE_SIZE,
      }),
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.page * lastPage.pageSize;
      return loaded < lastPage.total ? lastPage.page + 1 : undefined;
    },
  });

  const items = query.data?.pages.flatMap((page) => page.list) ?? [];
  // 固定两列：商品不够就留空列，不把单张卡片拉满整行
  const columns = splitIntoColumns(items, 2);

  // 哨兵进入可视区域就加载下一页；root 用区块自己的滚动容器
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const root = scrollRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((entry) => entry.isIntersecting) &&
          query.hasNextPage &&
          !query.isFetchingNextPage
        ) {
          void query.fetchNextPage();
        }
      },
      {
        root: root && root.scrollHeight > root.clientHeight ? root : null,
        rootMargin: '120px',
      },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [query]);

  return (
    <div
      data-testid="related-products"
      style={{
        // 桌面端：贴着视口，区块内独立滚动
        position: 'sticky',
        top: 16,
        maxHeight: 'calc(100vh - 96px)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--ant-color-bg-container)',
        border: '1px solid var(--ant-color-border-secondary)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid var(--ant-color-border-secondary)',
          fontWeight: 600,
        }}
      >
        猜你喜欢
      </div>
      <div
        ref={scrollRef}
        style={{ overflowY: 'auto', padding: 12, flex: 1, minHeight: 0 }}
      >
        {query.isLoading ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Spin size="small" />
          </div>
        ) : items.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无推荐" />
        ) : (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            {columns.map((bucket, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 列是固定两列容器，行内容由卡片 key 决定
              <div key={index} style={{ flex: '1 1 0', minWidth: 0 }}>
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  {bucket.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      variant="compact"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div ref={sentinelRef} style={{ height: 1 }} />

        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          {query.isFetchingNextPage ? (
            <Spin size="small" />
          ) : query.hasNextPage ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              继续滚动加载…
            </Typography.Text>
          ) : items.length > 0 ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              没有更多了
            </Typography.Text>
          ) : null}
        </div>
      </div>
    </div>
  );
}
