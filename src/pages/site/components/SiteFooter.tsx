import { useIntl } from '@umijs/max';
import { Col, Row } from 'antd';
import { useSiteBrand } from '@/hooks/useSiteBrand';
import useStyles from '../style';

export default function SiteFooter({
  showLinks = true,
}: {
  /** 纯介绍页传 false：页脚只保留品牌与版权，不出现任何跳转入口 */
  showLinks?: boolean;
}) {
  const { styles } = useStyles();
  const { formatMessage } = useIntl();
  // 站名与一句话介绍以租户品牌为准（在「站点品牌」里填），
  // 没填才回落到默认文案 —— 以前这里写死了模板站名，改品牌后页脚不变很割裂。
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

  const columns = [
    {
      title: 'site.footer.col.product',
      links: [
        { id: 'site.footer.link.console', href: '/dashboard/analysis' },
        { id: 'site.footer.link.portal', href: '/portal' },
        { id: 'site.footer.link.seller', href: '/portal/seller' },
      ],
    },
    {
      title: 'site.footer.col.resource',
      links: [
        { id: 'site.footer.link.readme', href: '/welcome' },
        { id: 'site.footer.link.docs', href: '/welcome' },
        { id: 'site.footer.link.api', href: 'http://127.0.0.1:9000/docs' },
      ],
    },
    {
      title: 'site.footer.col.account',
      links: [
        { id: 'site.footer.link.login', href: '/user/login' },
        { id: 'site.footer.link.register', href: '/user/register' },
      ],
    },
  ];

  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <Row gutter={[32, 24]}>
          <Col xs={24} md={10}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
              {siteName}
            </div>
            <div
              style={{ opacity: 0.65, fontSize: 13, whiteSpace: 'pre-line' }}
            >
              {tagline}
            </div>
          </Col>
          {showLinks &&
            columns.map((column) => (
              <Col
                xs={12}
                md={14 / 3}
                key={column.title}
                style={{ minWidth: 120 }}
              >
                <div className={styles.footerColTitle}>
                  {formatMessage({
                    id: column.title,
                    defaultMessage: column.title,
                  })}
                </div>
                {column.links.map((link) => (
                  <a
                    key={link.id}
                    className={styles.footerLink}
                    href={link.href}
                  >
                    {formatMessage({ id: link.id, defaultMessage: link.id })}
                  </a>
                ))}
              </Col>
            ))}
        </Row>
        <div className={styles.footerBottom}>
          <span>
            © {new Date().getFullYear()}{' '}
            {formatMessage({
              id: 'site.footer.copyright',
              defaultMessage: '赛霄玄思 · 保留所有权利',
            })}
          </span>
          <span>Apache-2.0</span>
        </div>
      </div>
    </footer>
  );
}
