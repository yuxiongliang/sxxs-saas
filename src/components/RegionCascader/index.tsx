import { useQuery } from '@tanstack/react-query';
import { Cascader } from 'antd';
import { getRegions } from '@/services/commerce/api';

/**
 * 省-市-区 三级级联。
 *
 * 数据来自后端 `/public/regions`（内置行政区划，随仓库走，不依赖高德/联网）——
 * 高德只做地理编码，没有区划树；外部 API 挂了不应该导致买家填不了地址。
 *
 * **值就是 `['广东省','深圳市','南山区']` 这样的数组**，可以直接挂到 `Form.Item` 上：
 * 之前用的是 `{province,city,district}` 对象 + 三个未注册的隐藏字段，
 * `validateFields()` 拿不到它们，于是"选了省市区但保存下来是空的"。
 */
export type RegionValue = string[];

export default function RegionCascader({
  value,
  onChange,
  placeholder = '请选择省 / 市 / 区',
}: {
  value?: RegionValue;
  onChange?: (value: RegionValue) => void;
  placeholder?: string;
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

  return (
    <Cascader
      style={{ width: '100%' }}
      options={options}
      value={(value ?? []) as string[]}
      loading={regions.isLoading}
      placeholder={placeholder}
      showSearch
      allowClear
      onChange={(picked) => onChange?.((picked ?? []) as string[])}
    />
  );
}
