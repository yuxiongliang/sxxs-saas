/**
 * 这个文件作为组件的目录
 * 目的是统一管理对外输出的组件，方便分类
 *
 * **约定（见 CLAUDE.md → Critical Rules）**：页面里要用可复用业务组件，
 * 一律 `import { X } from '@/components'`，不要按路径到处 import ——
 * 否则同一个组件在不同页面被复制出第二份，改一处就漏一处。
 */
/**
 * 布局组件
 */
import Footer from './Footer';
import { DocLink, LangDropdown, VersionDropdown } from './RightContent';
import { AvatarDropdown } from './RightContent/AvatarDropdown';
import { ThemeSwitch } from './RightContent/ThemeSwitch';

/**
 * 业务组件
 */
export { default as ArticleListContent } from './ArticleListContent';
export { default as AttachmentPicker } from './AttachmentPicker';
export { default as AttachmentUpload } from './AttachmentUpload';
export { default as AvatarList } from './AvatarList';
export { default as ErrorBoundary } from './ErrorBoundary';
export { CopyableText, PersonCell } from './IdentityText';
export { default as ImChat } from './ImChat';
export { default as ListToolbar } from './ListToolbar';
export type { LocationValue } from './LocationPicker';
export { default as LocationPicker } from './LocationPicker';
export { default as MediaField, PUBLIC_ATTACHMENT_PREFIX } from './MediaField';
export { default as OfflineBanner } from './OfflineBanner';
export { default as PageTabs } from './PageTabs';
export { default as ProductFavoriteTable } from './ProductFavoriteTable';
export { default as ProductReviewTable } from './ProductReviewTable';
export { default as RegionCascader } from './RegionCascader';
export type { ReviewableItem } from './ReviewFormModal';
export { default as ReviewFormModal } from './ReviewFormModal';
export type { RichTextValue } from './RichTextEditor';
export { default as RichTextEditor, EMPTY_DOC } from './RichTextEditor';
export { default as RichTextViewer } from './RichTextViewer';
export { default as StandardFormRow } from './StandardFormRow';
export { default as TagSelect } from './TagSelect';
export { default as UserMenu } from './UserMenu';

export {
  AvatarDropdown,
  DocLink,
  Footer,
  LangDropdown,
  ThemeSwitch,
  VersionDropdown,
};
