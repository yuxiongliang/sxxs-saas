import { useQuery } from '@tanstack/react-query';
import { Cascader } from 'antd';
import { getRegions } from '@/services/commerce/api';

/**
 * 省-市-区 三级级联。
 *
 * 数据来自后端 `/public/regions`（内置行政区划，随仓库走，不依赖高德/联网）——
 * 高德只做地理编码，没有区划树；外部 API 挂了不应该导致买家填不了地址。
 *
 * 表单里存的是**裸名称**（省名 / 市名 / 区名），与历史数据一致，不存 code。
 */
export default function RegionCascader({
  value,
  onChange,
}: {
  value?: { province?: string; city?: string; district?: string };
  onChange?: (value: {
    province?: string;
    city?: string;
    district?: string;
  }) => void;
}) {
  const regions = useQuery({
    queryKey: ['public-regions'],
    queryFn: getRegions,
    staleTime: 24 * 60 * 60 * 1000,
  });

  const options = (regions.data ?? []).map((province) => ({
    value: province.name,
    label: province.name,
    children: (province.children ?? []).map((city) => ({
      value: city.name,
      label: city.name,
      children: (city.children ?? []).map((district) => ({
        value: district.name,
        label: district.name,
      })),
    })),
  }));

  const selected = [value?.province, value?.city, value?.district].filter(
    Boolean,
  ) as string[];

  return (
    <Cascader
      style={{ width: '100%' }}
      options={options}
      value={selected}
      loading={regions.isLoading}
      placeholder="请选择省 / 市 / 区"
      showSearch
      allowClear
      onChange={(picked) => {
        const [province, city, district] = (picked ?? []) as string[];
        onChange?.({ province, city, district });
      }}
    />
  );
}
