import { useEffect, useState } from 'react';
import type { PublicProduct } from '@/services/commerce/api';
import { columnsForWidth, splitIntoColumns } from './masonry';
import ProductCard from './ProductCard';

/** 监听视口宽度（列数按断点算，不用 antd 栅格——栅格天生对齐，做不出错开）。 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth,
  );
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

/**
 * 商品瀑布流：JS 分列 + 每列独立 flex 纵向堆叠。
 *
 * 为什么不用 CSS `columns`：它是竖向填充，会打乱「综合排序」的阅读顺序（见 masonry.ts 注释）。
 * 为什么不用 antd `Row/Col`：24 栅格切不出 5 等分，而且栅格是等高对齐的。
 */
export default function ProductMasonry({
  products,
  variant = 'masonry',
  columns,
  testId = 'product-masonry',
}: {
  products: PublicProduct[];
  variant?: 'masonry' | 'compact';
  /** 不传就按视口宽度算（5/4/3/2） */
  columns?: number;
  testId?: string;
}) {
  const width = useViewportWidth();
  const columnCount = columns ?? columnsForWidth(width);
  const buckets = splitIntoColumns(products, columnCount);

  return (
    <div
      data-testid={testId}
      data-columns={columnCount}
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
      }}
    >
      {buckets.map((bucket, index) => (
        // 列本身不是稳定实体，用序号做 key 即可（同一个商品只出现在一列里）
        // biome-ignore lint/suspicious/noArrayIndexKey: 列顺序固定，行内容变化会由卡片 key 处理
        <div key={index} style={{ flex: '1 1 0', minWidth: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {bucket.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                variant={variant}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
