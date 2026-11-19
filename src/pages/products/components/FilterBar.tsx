import { ClearOutlined, EnvironmentOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useIntl } from '@umijs/max';
import {
  Button,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import RegionCascader from '@/components/RegionCascader';
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
  /** 同城：按商品所在地的「市」精确匹配（不需要定位） */
  city?: string;
  /** 距离范围（公里）：需要买家坐标 */
  radiusKm?: number;
}

export const SORT_OPTIONS: Array<{ value: ProductSort; label: string }> = [
  { value: 'default', label: '综合排序' },
  { value: 'sold_desc', label: '销量从高到低' },
  { value: 'newest', label: '最新发布' },
  { value: 'price_asc', label: '价格从低到高' },
  { value: 'price_desc', label: '价格从高到低' },
  // 需要买家定位；没定位时后端会忽略这个排序，界面会提示"开启定位"
  { value: 'distance', label: '离我最近' },
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
  total,
  loading = false,
  buyerCity,
  locationState = 'idle',
  onRequestLocation,
}: {
  filters: ProductFilters;
  onChange: (patch: Partial<ProductFilters>) => void;
  onReset: () => void;
  /** 结果总数：原来在页头「共 N 件」，页头删了以后在筛选栏右侧回显 */
  total?: number;
  loading?: boolean;
  /** 买家当前城市（来自定位反查；没有就是 null） */
  buyerCity?: string | null;
  /** 定位状态：用于给「同城/距离」选项做出提示 */
  locationState?: 'idle' | 'pending' | 'ready' | 'denied';
  onRequestLocation?: () => void;
}) {
  // 搜索框用本地 state：打字过程不需要同步到 URL（否则每敲一下都进历史记录）
  const [keyword, setKeyword] = useState(filters.keyword ?? '');
  useEffect(() => {
    setKeyword(filters.keyword ?? '');
  }, [filters.keyword]);

  const { formatMessage: t } = useIntl();

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
    filters.sort !== 'default' ||
    Boolean(filters.city) ||
    filters.radiusKm !== undefined;

  // 手动选城市兜底：没定位 / 高德未配置时，同城也要能用（选择自己的城市即可）
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const [pickedRegion, setPickedRegion] = useState<string[]>([]);

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

      {/*
        分类可搜索：分类是平台统一维护的，数量会持续增长，
        让运营/买家在长列表里滚不现实。`optionFilterProp="label"` 按中文名匹配。
      */}
      <Select
        allowClear
        showSearch
        optionFilterProp="label"
        placeholder="全部分类"
        style={{ width: 150 }}
        value={filters.categoryId}
        onChange={(value) => onChange({ categoryId: value ?? undefined })}
        options={(categories.data ?? []).map((item) => ({
          value: item.id,
          label: item.name,
        }))}
        notFoundContent={categories.isLoading ? '加载中…' : '没有匹配的分类'}
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

      {/* 同城：不依赖定位（用地名），但对未定位用户要知道自己在哪个市 */}
      <Button
        data-testid="product-city-toggle"
        type={filters.city ? 'primary' : 'default'}
        ghost={Boolean(filters.city)}
        onClick={() => {
          if (filters.city) {
            onChange({ city: undefined });
            return;
          }
          if (buyerCity) onChange({ city: buyerCity });
          // 没有定位结果（权限被拒/高德未配置）→ 手动选城市，功能不能只挂在定位上
          else setCityPickerOpen(true);
        }}
        title={
          buyerCity
            ? `只看 ${buyerCity} 的商品`
            : '需要先定位（或允许浏览器定位）才能筛同城'
        }
      >
        <EnvironmentOutlined />{' '}
        {filters.city ? `同城：${filters.city}` : '只看同城'}
      </Button>

      {/* 距离范围：依赖定位；未定位时点了会触发授权 */}
      <Select
        allowClear
        style={{ width: 130 }}
        data-testid="product-radius"
        placeholder="距离不限"
        value={filters.radiusKm}
        onChange={(value) => {
          if (value && locationState !== 'ready') onRequestLocation?.();
          onChange({ radiusKm: value ?? undefined });
        }}
        options={[
          { value: 3, label: '3 km 内' },
          { value: 10, label: '10 km 内' },
          { value: 50, label: '50 km 内' },
          { value: 200, label: '200 km 内' },
        ]}
      />

      <Select
        style={{ width: 160 }}
        data-testid="product-sort"
        value={filters.sort}
        onChange={(value) => {
          // 选「离我最近」但还没定位 → 先要授权，否则后端会忽略排序
          if (value === 'distance' && locationState !== 'ready') {
            onRequestLocation?.();
          }
          onChange({ sort: value });
        }}
        options={SORT_OPTIONS}
      />

      {locationState === 'denied' &&
      (filters.sort === 'distance' ||
        filters.radiusKm !== undefined ||
        filters.city) ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          未获得定位权限：同城可按城市名筛，距离相关需允许定位
        </Typography.Text>
      ) : null}

      {hasFilter ? (
        <Button icon={<ClearOutlined />} onClick={onReset}>
          清空筛选
        </Button>
      ) : null}

      <Modal
        open={cityPickerOpen}
        title="选择同城城市"
        okText="只看这个城市"
        cancelText="取消"
        onCancel={() => setCityPickerOpen(false)}
        onOk={() => {
          const city = pickedRegion[1];
          if (!city) return;
          onChange({ city });
          setCityPickerOpen(false);
        }}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          没拿到你的定位，可以手动选一个城市；也可允许浏览器定位后自动识别。
        </Typography.Paragraph>
        <RegionCascader
          value={pickedRegion}
          onChange={(next) => setPickedRegion(next ?? [])}
        />
      </Modal>

      {priceInvalid ? (
        <Typography.Text type="danger" style={{ fontSize: 12 }}>
          最低价不能高于最高价
        </Typography.Text>
      ) : null}

      {/* 结果数：页头区块删掉后，避免用户不知道筛出来多少东西 */}
      <div style={{ marginLeft: 'auto' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {loading
            ? '…'
            : t(
                { id: 'mall.products.count', defaultMessage: '共 {count} 件' },
                { count: total ?? 0 },
              )}
        </Typography.Text>
      </div>
    </div>
  );
}
