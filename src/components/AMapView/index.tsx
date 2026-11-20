import { useEffect, useRef, useState } from 'react';
import type { AMapConfig } from '@/services/amap/api';

declare global {
  interface Window {
    AMap?: any;
    _AMapSecurityConfig?: Record<string, string>;
  }
}

let loader: Promise<any> | null = null;

/**
 * 按需加载高德 JS API 2.0。
 *
 * 关键顺序：window._AMapSecurityConfig 必须在 <script> 插入**之前**赋值，
 * 之后再设置无效（高德官方明确要求）。
 */
function loadAMap(config: AMapConfig): Promise<any> {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    if (!config.jsKey) {
      reject(new Error('未配置高德 Web端(JS API) key'));
      return;
    }
    window._AMapSecurityConfig = config.useProxy
      ? { serviceHost: config.serviceHost ?? '' }
      : { securityJsCode: config.securityCode ?? '' };
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${config.jsKey}`;
    script.async = true;
    script.onload = () =>
      window.AMap ? resolve(window.AMap) : reject(new Error('AMap 未挂载'));
    script.onerror = () =>
      reject(new Error('高德 JS API 脚本加载失败（检查 key 与域名白名单）'));
    document.head.appendChild(script);
  });
  return loader;
}

export interface AMapViewProps {
  config: AMapConfig;
  height?: number;
  /** 点击地图回调，返回高德坐标（GCJ-02） */
  onPick?: (lng: number, lat: number) => void;
  /**
   * 受控中心点 `[lng, lat]`：变了就把地图移过去。
   * 用于「使用我的位置」——点了之后地图必须跟着走，而不是停在北京。
   */
  center?: [number, number] | null;
  /** 受控标注 `[lng, lat]`：传了就在该处显示/移动标注，传 null 移除 */
  marker?: [number, number] | null;
  /** 标注标题（高德 marker 的 title，鼠标悬浮可见） */
  markerTitle?: string;
  /** 中心点变化时的缩放级别（默认 15：能看清街道） */
  centerZoom?: number;
}

export default function AMapView({
  config,
  height = 320,
  onPick,
  center,
  marker,
  markerTitle,
  centerZoom = 15,
}: AMapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  // 高德的构造器：受控 center/marker 的 effect 里要用
  const amapRef = useRef<any>(null);
  const [error, setError] = useState<string>('');
  /**
   * 地图是**异步创建**的（要先加载高德脚本）。受控 center/marker 的 effect
   * 往往在地图创建前就跑完了，那一次必须记住最新值，等地图就绪再补一次 ——
   * 否则「使用我的位置」点了以后地图停在默认中心（北京），标注也不出现。
   */
  const centerRef = useRef(center);
  centerRef.current = center;
  const markerPosRef = useRef(marker);
  markerPosRef.current = marker;
  const markerTitleRef = useRef(markerTitle);
  markerTitleRef.current = markerTitle;
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    loadAMap(config)
      .then((AMap) => {
        if (disposed || !containerRef.current) return;
        const [lng, lat] = (config.defaultCenter || '116.397428,39.90923')
          .split(',')
          .map((item) => Number(item.trim()));
        const map = new AMap.Map(containerRef.current, {
          zoom: config.defaultZoom || 11,
          center: [lng, lat],
        });
        mapRef.current = map;
        amapRef.current = AMap;
        // 创建前到的 center/marker 要在这里补上（见 centerRef 注释）
        const initialCenter = centerRef.current;
        if (initialCenter) {
          map.setZoomAndCenter?.(centerZoom, initialCenter);
        }
        const initialMarker = markerPosRef.current;
        if (initialMarker) {
          markerRef.current = new AMap.Marker({
            position: initialMarker,
            map,
            title: markerTitleRef.current,
          });
        }
        setMapReady(true);
        if (onPick) {
          map.on('click', (event: any) => {
            const position = [event.lnglat.getLng(), event.lnglat.getLat()];
            if (!markerRef.current) {
              markerRef.current = new AMap.Marker({
                position,
                map,
                title: markerTitle,
              });
            } else {
              markerRef.current.setPosition(position);
            }
            onPick(position[0], position[1]);
          });
        }
      })
      .catch((err: Error) => setError(err.message));
    return () => {
      disposed = true;
      mapRef.current?.destroy?.();
      mapRef.current = null;
      markerRef.current = null;
      setMapReady(false);
    };
    // config 变化时重建地图（key / 中心点切换）
  }, [config.jsKey, config.useProxy, config.serviceHost, config.securityCode]);

  // 受控中心点：位置变了就把地图移过去（「使用我的位置」就靠这个）
  useEffect(() => {
    if (!center) return;
    const map = mapRef.current;
    if (!map) return;
    if (typeof map.setZoomAndCenter === 'function') {
      map.setZoomAndCenter(centerZoom, center);
    } else {
      map.setCenter(center);
    }
  }, [center?.[0], center?.[1], centerZoom, mapReady]);

  // 受控标注：创建/移动/移除，都不重建地图
  useEffect(() => {
    const AMap = amapRef.current;
    const map = mapRef.current;
    if (!AMap || !map) return;
    if (!marker) {
      markerRef.current?.setMap?.(null);
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      markerRef.current = new AMap.Marker({
        position: marker,
        map,
        title: markerTitle,
      });
    } else {
      markerRef.current.setPosition(marker);
    }
  }, [marker?.[0], marker?.[1], markerTitle, mapReady]);

  if (error) {
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px dashed #d9d9d9',
          borderRadius: 8,
          color: '#999',
          padding: 16,
          textAlign: 'center',
        }}
      >
        {error}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ height, width: '100%', borderRadius: 8 }}
    />
  );
}
