import { Space, Typography } from 'antd';

/**
 * 全站「人物标识」统一组件。
 *
 * 口径（`CLAUDE.md` → Critical Rules）：任何界面上的人物，一律
 * **用户ID（`usr_xxx`，可复制）+ 用户名**，绝不显示裸自增 id。
 * 店铺名 / 卖家名只能做副行。
 *
 * 为什么抽成组件而不是每处各写一遍：这个口径已经改过三轮，
 * 每次都是「某几个页面漏了」。有一个共同组件，新页面想漏都难。
 */

/** 可复制的编号（用户ID / 订单号之类）。空值给占位符，不显示 `null`。 */
export function CopyableText({
  text,
  placeholder = '—',
}: {
  text?: string | null;
  placeholder?: string;
}) {
  if (!text) {
    return <Typography.Text type="secondary">{placeholder}</Typography.Text>;
  }
  return (
    <Typography.Text code copyable={{ text }}>
      {text}
    </Typography.Text>
  );
}

/**
 * 一个人：用户ID + 用户名（上下两行）。
 *
 * 紧凑场景（表格里）用 `inline` 横排。
 */
export function PersonCell({
  publicId,
  username,
  secondary,
  inline = false,
  secondaryLabel,
}: {
  publicId?: string | null;
  username?: string | null;
  /** 副行：店铺名 / 卖家名 / 角色等 */
  secondary?: string | null;
  inline?: boolean;
  secondaryLabel?: string;
}) {
  if (inline) {
    return (
      <Space size={6}>
        <CopyableText text={publicId} placeholder="用户已删除" />
        <Typography.Text>{username ?? '-'}</Typography.Text>
        {secondary ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {secondaryLabel ? `${secondaryLabel}：` : ''}
            {secondary}
          </Typography.Text>
        ) : null}
      </Space>
    );
  }
  return (
    <>
      <div>
        <CopyableText text={publicId} placeholder="用户已删除" />
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {username ?? '-'}
        {secondary ? ` · ${secondary}` : ''}
      </Typography.Text>
    </>
  );
}
