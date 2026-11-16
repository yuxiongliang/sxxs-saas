import { useIntl } from '@umijs/max';
import { useSiteBrand } from '@/hooks/useSiteBrand';
import useStyles from '../style';

/**
 * 公开站点页脚：只保留**品牌块**（logo + 一句话介绍）与版权行。
 *
 * 原来这里还有「产品 / 资源 / 账户」三列外链和一行 `Apache-2.0`：
 * 那些入口对访客是噪音（控制台、接口文档、注册页都会把买家引走），已整体删除。
 * 品牌信息一律取「站点品牌」页填的内容，不在代码里写死站名。
 */
export default function SiteFooter() {
  const { styles } = useStyles();
  const { formatMessage } = useIntl();
  const brand = useSiteBrand();
  const siteName =
    brand?.display_name ||
    formatMessage({ id: 'site.hero.title', defaultMessage: '赛霄玄思' });
  const tagline =
    brand?.site_description ||
    formatMessage({
      id: 'site.footer.tagline',
      defaultMessage: '多租户 C2C 商城管理后台',
    });

  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <div className={styles.footerBrand}>
          {brand?.logo_url ? (
            <img
              className={styles.footerLogo}
              src={brand.logo_url}
              alt={siteName}
            />
          ) : (
            <div className={styles.footerBrandName}>{siteName}</div>
          )}
          <div className={styles.footerTagline}>{tagline}</div>
        </div>

        <div className={styles.footerBottom}>
          <span>
            © {new Date().getFullYear()} {siteName} ·{' '}
            {formatMessage({
              id: 'site.footer.copyright.reserved',
              defaultMessage: '保留所有权利',
            })}
          </span>
        </div>
      </div>
    </footer>
  );
}
