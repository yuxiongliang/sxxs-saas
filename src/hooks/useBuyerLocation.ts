import { useEffect, useState } from 'react';

export interface BuyerLocation {
  latitude: number;
  longitude: number;
}

const CACHE_KEY = 'buyer-location-v1';
/** 缓存 10 分钟：位置不会走动那么快，也避免每次开页面都弹权限 */
const TTL_MS = 10 * 60 * 1000;

interface Cached {
  latitude: number;
  longitude: number;
  at: number;
}

function readCache(): BuyerLocation | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached;
    if (!parsed?.latitude || !parsed?.longitude) return null;
    if (Date.now() - parsed.at > TTL_MS) return null;
    return { latitude: parsed.latitude, longitude: parsed.longitude };
  } catch {
    return null;
  }
}

/** 把定位结果写进缓存（列表/详情/确认页共用一个位置，避免重复请求授权）。 */
export function cacheBuyerLocation(location: BuyerLocation) {
  try {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ ...location, at: Date.now() }),
    );
  } catch {
    /* 隐私模式禁写：退化成"每次重新定位"，不影响功能 */
  }
}

/**
 * 买家当前定位（用于「距您 x km」）。
 *
 * 三条硬规则：
 * 1. **不自动索取权限**：只在 `enabled` 为真时才开始；浏览器弹窗很烦人，
 *    用户没要求看距离时不该被打断。
 * 2. 有缓存直接用（10 分钟），过期才重新请求。
 * 3. 被拒绝/不可用 → 静默返回 null，界面只显示地名，**不要显示 0 公里**。
 */
export function useBuyerLocation(enabled = true): {
  location: BuyerLocation | null;
  pending: boolean;
  denied: boolean;
  request: () => void;
} {
  const [location, setLocation] = useState<BuyerLocation | null>(() =>
    readCache(),
  );
  const [pending, setPending] = useState(false);
  const [denied, setDenied] = useState(false);

  const request = () => {
    if (!('geolocation' in navigator)) {
      setDenied(true);
      return;
    }
    setPending(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        cacheBuyerLocation(next);
        setLocation(next);
        setDenied(false);
        setPending(false);
      },
      () => {
        setDenied(true);
        setPending(false);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
  };

  useEffect(() => {
    if (!enabled) return;
    if (location) return;
    if (denied) return;
    request();
  }, [enabled, location, denied]);

  return { location, pending, denied, request };
}
