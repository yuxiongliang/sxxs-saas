import { AimOutlined, EnvironmentOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Form, Input, Space, Spin, Typography } from 'antd';
import { useState } from 'react';
import AMapView from '@/components/AMapView';
import RegionCascader from '@/components/RegionCascader';
import { cacheBuyerLocation } from '@/hooks/useBuyerLocation';
import { getAMapFrontendConfig, regeo } from '@/services/amap/api';

/**
 * 商品/门店所在地选择器（表单控件）。
 *
 * 值形状：
 * ```ts
 * { province?, city?, district?, address?, latitude?, longitude? }
 * ```
 * 直接挂在 `Form.Item name="location"` 上 —— **必须是被注册的字段**，
 * 否则就是老坑："选了省市/点了地图，保存后是空的"。
 *
 * 两级能力：
 * 1. 省市区 + 地址文本：不依赖任何外部服务，永远可用（同城筛选只靠 city）；
 * 2. 地图选点 + 「使用我的位置」：需要高德 Web端 key（租户系统设置里配）。
 *    key 未配置时**不显示地图**，但字段仍可正常保存。
 */
export interface LocationValue {
  province?: string;
  city?: string;
  district?: string;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
}

export default function LocationPicker({
  value,
  onChange,
}: {
  value?: LocationValue;
  onChange?: (value: LocationValue) => void;
}) {
  const { message } = App.useApp();
  const [locating, setLocating] = useState(false);
  const current = value ?? {};

  const amap = useQuery({
    queryKey: ['amap-frontend-config'],
    queryFn: getAMapFrontendConfig,
    // 没配 key 时接口会报错，别重试打扰卖家
    retry: false,
    staleTime: 10 * 60 * 1000,
  });
  const mapReady = Boolean(amap.data?.jsKey);

  const patch = (next: Partial<LocationValue>) => {
    onChange?.({ ...current, ...next });
  };

  /** 浏览器定位 → 逆地理编码出省市区（逆地理走服务端代理，key 不出前端）。
   *  名字不能用 use 开头：Biome 会把它当成 Hook 工厂，报「hook 在条件里调用」。 */
  const locateMe = () => {
    if (!('geolocation' in navigator)) {
      message.warning('当前浏览器不支持定位');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        cacheBuyerLocation({ latitude, longitude });
        try {
          const resolved = await regeo(longitude, latitude);
          patch({
            province: resolved.province || current.province,
            city: resolved.city || current.city,
            district: resolved.district || current.district,
            address: resolved.formatted_address || current.address,
            latitude,
            longitude,
          });
          message.success('已定位到当前位置');
        } catch {
          // 逆地理失败也别丢坐标：坐标本身仍然有用
          patch({ latitude, longitude });
          message.warning('已获取坐标，但没能解析出地名，请手动选择省市区');
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        message.warning('定位失败或被拒绝，可手动选择地址或在地图上点选');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const pickOnMap = async (lng: number, lat: number) => {
    patch({ latitude: lat, longitude: lng });
    try {
      const resolved = await regeo(lng, lat);
      patch({
        latitude: lat,
        longitude: lng,
        province: resolved.province || current.province,
        city: resolved.city || current.city,
        district: resolved.district || current.district,
        address: resolved.formatted_address || current.address,
      });
    } catch {
      message.warning('坐标已记录，但没能解析出地名');
    }
  };

  const region = [current.province, current.city, current.district].filter(
    Boolean,
  ) as string[];

  return (
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      <Space wrap style={{ width: '100%' }} size={8}>
        <div style={{ minWidth: 260, flex: 1 }}>
          <RegionCascader
            value={region}
            onChange={(next) =>
              patch({
                province: next?.[0],
                city: next?.[1],
                district: next?.[2],
              })
            }
          />
        </div>
        <Button
          icon={<AimOutlined />}
          loading={locating}
          onClick={locateMe}
          data-testid="location-use-my-position"
        >
          使用我的位置
        </Button>
        {(current.latitude || current.longitude) && (
          <Button
            danger
            type="link"
            onClick={() => patch({ latitude: null, longitude: null })}
            data-testid="location-clear-coords"
          >
            清除坐标
          </Button>
        )}
      </Space>

      <Form.Item
        label="详细地址 / 地标"
        style={{ marginBottom: 0 }}
        extra="买家只会看到「省 市 区」，详细地址仅你和平台可见"
      >
        <Input
          value={current.address}
          placeholder="如：椒江区 XX 路 XX 号（选填）"
          allowClear
          onChange={(event) => patch({ address: event.target.value })}
        />
      </Form.Item>

      {mapReady && amap.data ? (
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <EnvironmentOutlined /> 在地图上点一下可以校正精确位置
            {current.latitude && current.longitude ? (
              <span>
                （当前：{Number(current.latitude).toFixed(5)},{' '}
                {Number(current.longitude).toFixed(5)}）
              </span>
            ) : null}
          </Typography.Text>
          <div style={{ marginTop: 8 }}>
            <AMapView
              config={amap.data}
              height={240}
              onPick={(lng, lat) => void pickOnMap(lng, lat)}
            />
          </div>
        </div>
      ) : (
        <Alert
          type="info"
          showIcon
          title="未配置高德地图，暂不能在地图上点选"
          description={
            amap.isLoading ? (
              <Spin size="small" />
            ) : (
              '省市区 + 地址仍会保存并用于同城筛选；配好「系统设置 → 高德地图」后即可用地图选点与「使用我的位置」。'
            )
          }
        />
      )}
    </Space>
  );
}
