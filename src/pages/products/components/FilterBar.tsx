import { ClearOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Input, InputNumber, Select, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import type { PublicProductQuery } from '@/services/commerce/api';
import { listPublicCategories } from '@/services/commerce/api';

export type ProductSort = NonNullable<PublicProductQuery['sort']>;

export interface ProductFilters {
  keyword?: string;
  categoryId?: number;
  /** 单位：元（对用户友好）；提交前换算成分 */
  minPrice?: number;
  maxPrice?: number;
  sort: ProductSort;
}

export const SORT_OPTIONS: Array<{ value: ProductSort; label: string }> = [
  { value: 'default', label: '综合排序' },
  { value: 'sold_desc', label: '销量从高到低' },
  { value: 'newest', label: '最新发布' },
  { value: 'price_asc', label: '价格从低到高' },
  { value: 'price_desc', label: '价格从高到低' },
];

/**
 * 买家端商品筛选栏：搜索 + 一级分类 + 价格区间 + 排序。
 *
 * 约定：
 * * 搜索**回车/点放大镜才触发**，不每敲一个字打一次接口；
 * * 价格由用户自己填（元），留空表示不限；
 * * 任何筛选变化都会把页码重置到第 1 页 —— 否则会出现「第 3 页 + 筛选后只有 1 页」的空页。
 */
export default function FilterBar({
  filters,
  onChange,
  onReset,
}: {
  filters: ProductFilters;
  onChange: (patch: Partial<ProductFilters>) => void;
  onReset: () => void;
}) {
  // 搜索框用本地 state：打字过程不需要同步到 URL（否则每敲一下都进历史记录）
  const [keyword, setKeyword] = useState(filters.keyword ?? '');
  useEffect(() => {
    setKeyword(filters.keyword ?? '');
  }, [filters.keyword]);

  const categories = useQuery({
    queryKey: ['public-categories'],
    queryFn: listPublicCategories,
    staleTime: 5 * 60_000,
  });

  const hasFilter =
    Boolean(filters.keyword) ||
    filters.categoryId !== undefined ||
    filters.minPrice !== undefined ||
    filters.maxPrice !== undefined ||
    filters.sort !== 'default';

  const priceInvalid =
    filters.minPrice !== undefined &&
    filters.maxPrice !== undefined &&
    filters.minPrice > filters.maxPrice;

  return (
    <div
      data-testid="product-filter-bar"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        marginBottom: 16,
        background: 'var(--ant-color-bg-container)',
        border: '1px solid var(--ant-color-border-secondary)',
        borderRadius: 8,
      }}
    >
      <Input.Search
        allowClear
        data-testid="product-search"
        placeholder="搜商品名 / 店铺 / 卖家"
        style={{ width: 280 }}
        value={keyword}
        onChange={(event) => {
          setKeyword(event.target.value);
          // 清空输入时立即复位，不必等回车
          if (!event.target.value) onChange({ keyword: undefined });
        }}
        onSearch={(value) => onChange({ keyword: value.trim() || undefined })}
      />

      <Select
        allowClear
        placeholder="全部分类"
        style={{ width: 150 }}
        value={filters.categoryId}
        onChange={(value) => onChange({ categoryId: value ?? undefined })}
        options={(categories.data ?? []).map((item) => ({
          value: item.id,
          label: item.name,
        }))}
      />

      <Space size={4} align="center">
        <InputNumber
          min={0}
          precision={0}
          placeholder="最低价"
          style={{ width: 110 }}
          value={filters.minPrice}
          status={priceInvalid ? 'error' : undefined}
          onChange={(value) => onChange({ minPrice: value ?? undefined })}
        />
        <Typography.Text type="secondary">~</Typography.Text>
        <InputNumber
          min={0}
          precision={0}
          placeholder="最高价"
          style={{ width: 110 }}
          value={filters.maxPrice}
          status={priceInvalid ? 'error' : undefined}
          onChange={(value) => onChange({ maxPrice: value ?? undefined })}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          元
        </Typography.Text>
      </Space>

      <Select
        style={{ width: 160 }}
        data-testid="product-sort"
        value={filters.sort}
        onChange={(value) => onChange({ sort: value })}
        options={SORT_OPTIONS}
      />

      {hasFilter ? (
        <Button icon={<ClearOutlined />} onClick={onReset}>
          清空筛选
        </Button>
      ) : null}

      {priceInvalid ? (
        <Typography.Text type="danger" style={{ fontSize: 12 }}>
          最低价不能高于最高价
        </Typography.Text>
      ) : null}
    </div>
  );
}
