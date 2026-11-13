/**
 * 站点品牌（公开接口，匿名可读）。
 *
 * 为什么不用 `@umijs/max` 的 `request`：品牌是装饰性数据，取不到时必须**静默降级**
 * 到默认标题/logo，不能因为一次 500 弹错误提示或把访客拽去登录页。
 * 后端按请求 Host 解析租户（B6），前端不传 tenant 参数。
 */
export interface PublicBrand {
  slug: string;
  name: string;
  display_name: string;
  logo_url?: string | null;
  favicon_url?: string | null;
}

const PUBLIC_BRAND_PATH = '/api/v1/public/brand';

export async function getPublicBrand(): Promise<PublicBrand | undefined> {
  try {
    const response = await fetch(PUBLIC_BRAND_PATH);
    if (!response.ok) return undefined;
    const body = await response.json();
    return body?.data as PublicBrand | undefined;
  } catch {
    return undefined;
  }
}

/** 把浏览器标签页图标换成租户自己的，取不到就保持原样。 */
export function applyBrandFavicon(faviconUrl?: string | null) {
  if (!faviconUrl) return;
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = faviconUrl;
}
