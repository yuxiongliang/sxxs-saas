import { useModel } from '@umijs/max';
import { createStyles } from 'antd-style';
import React from 'react';

const useStyles = createStyles(({ token, css }) => ({
  footer: css`
    padding: 16px 24px;
    text-align: center;
    color: ${token.colorTextDescription};
    font-size: ${token.fontSizeSM}px;
    line-height: ${token.lineHeight};
    background: transparent;
  `,
  copyright: css`
    margin-bottom: 6px;
  `,
  legal: css`
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 6px 16px;
  `,
  link: css`
    color: ${token.colorTextDescription};
    text-decoration: none;
    transition: color ${token.motionDurationMid};

    &:hover {
      color: ${token.colorText};
    }
  `,
}));

/**
 * 页脚：站点名版权 + ICP 备案信息。
 *
 * 原来这里还有一行 `ver / Umi / Utoo / GitHub` 的脚手架信息 —— 对租户和买家毫无意义，
 * 还会把内部版本号与仓库地址暴露给访客，已删除（按要求）。
 *
 * ICP 备案号与许可证号在「站点品牌」里填写：中国大陆站点没有备案号属于违规，
 * 但每个租户的号不同，不能写死在代码里。
 */
const Footer: React.FC = () => {
  const { styles } = useStyles();
  const { initialState } = useModel('@@initialState');
  const year = new Date().getFullYear();
  const brand = initialState?.brand;
  const siteName = brand?.display_name || 'Ant Design Pro';
  const icpNumber = brand?.icp_number;
  const icpLicense = brand?.icp_license;

  return (
    <div className={styles.footer}>
      <div className={styles.copyright}>
        {siteName} &copy; {year}
      </div>
      {icpNumber || icpLicense ? (
        <div className={styles.legal}>
          {icpNumber ? (
            <a
              className={styles.link}
              href="https://beian.miit.gov.cn"
              target="_blank"
              rel="noopener noreferrer"
            >
              {icpNumber}
            </a>
          ) : null}
          {icpLicense ? <span>{icpLicense}</span> : null}
        </div>
      ) : null}
    </div>
  );
};

export default Footer;
