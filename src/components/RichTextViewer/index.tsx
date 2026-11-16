import DOMPurify from 'dompurify';
import { useMemo } from 'react';
// 与编辑器共用同一份排版样式（改一处两边一起变）
import '@/components/RichTextEditor/style.css';

/**
 * 富文本渲染器（买家端 / 审核预览共用）。
 *
 * 两道防线：
 * 1. **服务端已经用 nh3 白名单清洗过**才落库（`services/rich_text.py`）；
 * 2. 这里再过一遍 **DOMPurify** —— 纵深防御。历史数据、导入数据、将来别的写入方
 *    都可能绕过第一道，渲染端不能假设 HTML 一定是干净的。
 *
 * 表格在窄屏会撑宽页面，所以外层容器允许横向滚动。
 */
export default function RichTextViewer({
  html,
  fallback,
}: {
  html?: string | null;
  /** 没有内容时显示的占位 */
  fallback?: React.ReactNode;
}) {
  const safeHtml = useMemo(() => {
    if (!html) return '';
    return DOMPurify.sanitize(html, {
      // 与后端白名单保持一致（后端更严，这里只是兜底）
      ALLOWED_TAGS: [
        'p',
        'br',
        'hr',
        'span',
        'strong',
        'b',
        'em',
        'i',
        'u',
        's',
        'del',
        'sub',
        'sup',
        'code',
        'pre',
        'blockquote',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'ul',
        'ol',
        'li',
        'a',
        'img',
        'table',
        'thead',
        'tbody',
        'tfoot',
        'tr',
        'th',
        'td',
        'colgroup',
        'col',
        'caption',
        'input',
      ],
      ALLOWED_ATTR: [
        'style',
        'class',
        'href',
        'target',
        'rel',
        'title',
        'src',
        'alt',
        'width',
        'height',
        'start',
        'type',
        'colspan',
        'rowspan',
        'colwidth',
        'data-checked',
        'data-type',
        'checked',
        'disabled',
      ],
      // 明确禁掉这几类：即使后端漏了也不会执行
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'style'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'srcdoc'],
    });
  }, [html]);

  if (!safeHtml) {
    return <>{fallback ?? null}</>;
  }

  return (
    <div
      className="rich-content"
      data-testid="rich-text-viewer"
      style={{ overflowX: 'auto' }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: 内容有两道清洗——后端 nh3 白名单 + 这里 DOMPurify，且禁止 script/iframe/on* 属性
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}
