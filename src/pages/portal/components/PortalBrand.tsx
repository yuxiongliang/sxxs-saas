import { ShopOutlined } from '@ant-design/icons';
import { Link } from '@umijs/max';
import type { PublicBrand } from '@/services/publicBrand';

/** 顶栏高度：品牌块放大后需要更多垂直空间，两个外壳共用同一个值 */
export const PORTAL_HEADER_HEIGHT = 64;
/** logo 目标高度：宽度按图片自身比例撑开（站名 logo 多是横版字标，用正方形框会把字压成 10px 高） */
const LOGO_HEIGHT = 40;
/** 宽度上限：极宽的图不至于把右半边挤出屏幕 */
const LOGO_MAX_WIDTH = 220;

type Props = {
  brand?: PublicBrand;
};

/**
 * 用户中心顶栏的**品牌块**：只显示 logo，不显示站名文字。
 *
 * 为什么只留 logo：
 * - 站名在浏览器标签、页脚、登录页都已经出现，顶栏再写一遍是重复；
 * - logo 本身是品牌资产，文字会把 logo 挤小、把顶栏挤高。
 *
 * 站名通过 `aria-label` / `title` 保留 —— 屏幕阅读器和悬停提示仍然拿得到，
 * 链接也不会变成"没有可访问名的空链接"。租户没传 logo 时回落到图标。
 *
 * 容器**按高度约束 + 宽度自适应**：横版字标（如 548×129）能拿到 40px 高、~170px 宽；
 * 正方形图标也能正常显示。用固定 44×44 方框 + `contain` 会把字标压成 10px 高，等于没放大。
 *
 * 买家中心（`PortalLayout`）和支付结果页（`PortalPlainShell`）共用，避免两处走样。
 */
export default function PortalBrand({ brand }: Props) {
  return (
    <Link
      to="/products"
      aria-label={brand?.display_name || 'C2C 商城'}
      title={brand?.display_name || 'C2C 商城'}
      data-testid="portal-brand"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: LOGO_HEIGHT,
        maxWidth: LOGO_MAX_WIDTH,
        flex: '0 0 auto',
      }}
    >
      {brand?.logo_url ? (
        <img
          src={brand.logo_url}
          alt={brand.display_name}
          style={{
            height: '100%',
            width: 'auto',
            maxWidth: '100%',
            objectFit: 'contain',
            display: 'block',
          }}
        />
      ) : (
        <ShopOutlined style={{ fontSize: 28 }} />
      )}
    </Link>
  );
}
