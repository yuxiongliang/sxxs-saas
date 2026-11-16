import { useEffect, useState } from 'react';
import type { PublicBrand } from '@/services/publicBrand';

/**
 * 公开站点品牌（匿名可读），同一个页面里只请求一次。
 *
 * 为什么要有这个 hook：`SiteHeader` 和 `SiteFooter` 都要站名，
 * 原来 `SiteHeader` 自己 fetch、`SiteFooter` 直接写死模板文案，
 * 于是「页脚站名」和「头部站名」可以不一致。现在两处都读这一份，
 * 模块级缓存保证一次页面访问只打一次接口。
 *
 * 取不到时返回 undefined —— 调用方必须能接受空值并回落到默认文案，
 * 品牌是装饰性数据，不能因为一次 500 让整站白屏。
 */
let cachedBrand: PublicBrand | undefined;
let inflight: Promise<PublicBrand | undefined> | null = null;

async function loadBrand(): Promise<PublicBrand | undefined> {
  if (cachedBrand) return cachedBrand;
  if (!inflight) {
    inflight = fetch('/api/v1/public/brand')
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        cachedBrand = (body?.data as PublicBrand) ?? undefined;
        return cachedBrand;
      })
      .catch(() => undefined);
  }
  return inflight;
}

export function useSiteBrand(): PublicBrand | undefined {
  const [brand, setBrand] = useState<PublicBrand | undefined>(cachedBrand);

  useEffect(() => {
    let alive = true;
    loadBrand().then((value) => {
      if (alive) setBrand(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  return brand;
}
