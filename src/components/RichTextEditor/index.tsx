import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { ListKit } from '@tiptap/extension-list';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { TableKit } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import Typography from '@tiptap/extension-typography';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Typography as AntTypography, App } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import AttachmentPicker from '@/components/AttachmentPicker';
import { PUBLIC_ATTACHMENT_PREFIX } from '@/components/MediaField';
import RichTextToolbar from './Toolbar';
import './style.css';

export interface RichTextValue {
  /** ProseMirror doc —— 真身，存库回显用 */
  doc: Record<string, unknown> | null;
  /** 编辑器生成的 HTML，服务端会用 nh3 重新清洗后再落库 */
  html: string;
}

export const EMPTY_DOC: Record<string, unknown> = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

/**
 * 富文本编辑器（Tiptap v3，能力全量）。
 *
 * 为什么扩展用 **Kit** 而不是逐个装：v3 把 list / table / text-style 收进元包了，
 * 单引 `Table` 会缺 `tableRow`、单引 `TaskList` 会缺 `taskItem`，
 * 运行时报 `No node type or group 'xxx' found`。（spike 时踩过。）
 *
 * 受控方式：`value.doc` 变化时 `setContent`；用户编辑时回调 `onChange({doc, html})`。
 * 回写时用 `emitUpdate=false`，否则每次外部赋值都会再触发一轮 onChange，形成回环。
 */
export default function RichTextEditor({
  value,
  onChange,
  placeholder = '填写商品详情：成色、规格、配件、注意事项…',
  minHeight = 320,
  disabled = false,
}: {
  value?: RichTextValue | null;
  onChange?: (next: RichTextValue) => void;
  placeholder?: string;
  minHeight?: number;
  disabled?: boolean;
}) {
  const { message } = App.useApp();
  const [imageOpen, setImageOpen] = useState(false);
  // 用 ref 记住「上一次由外部传入的 html」，避免自己改的东西回灌
  const lastExternal = useRef<string>('');

  const extensions = useMemo(
    () => [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      ListKit,
      TableKit.configure({ table: { resizable: true } }),
      TextStyleKit,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image.configure({ inline: false, allowBase64: false }),
      Subscript,
      Superscript,
      Typography,
      Placeholder.configure({ placeholder }),
      CharacterCount,
    ],
    [placeholder],
  );

  const editor = useEditor({
    // Umi 是 CSR，但关掉立即渲染可避免 SSR/首屏结构不一致带来的 hydration 警告
    immediatelyRender: false,
    editable: !disabled,
    extensions,
    content: value?.doc ?? EMPTY_DOC,
    onUpdate: ({ editor: instance }) => {
      const html = instance.getHTML();
      // ★ 关键：把「自己刚产生的内容」记到 lastExternal，
      //   否则上层 onChange 更新 value → 下面的 useEffect 误判为外部变化 →
      //   `setContent` 把光标/结构打散（表现为打一个字就被重置，doc 被切成好几段）。
      lastExternal.current = html;
      onChange?.({
        doc: instance.getJSON() as Record<string, unknown>,
        html,
      });
    },
    editorProps: {
      attributes: {
        // 与买家端渲染容器同一套样式类（改一处两边一起变）
        class: 'rich-content',
        style: `min-height:${minHeight}px`,
      },
      // 粘贴/拖拽进来的图片交给附件中心，不走 base64（base64 会把 doc 撑爆）
      handlePaste: (_view, event) => {
        const file = Array.from(event.clipboardData?.files ?? [])[0];
        if (!file?.type.startsWith('image/')) return false;
        event.preventDefault();
        void uploadFile(file);
        return true;
      },
      handleDrop: (_view, event) => {
        const file = Array.from(
          (event as DragEvent).dataTransfer?.files ?? [],
        )[0];
        if (!file?.type.startsWith('image/')) return false;
        event.preventDefault();
        void uploadFile(file);
        return true;
      },
    },
  });

  // 外部值变化（例如切换商品）时同步到编辑器
  useEffect(() => {
    if (!editor) return;
    const incomingHtml = value?.html ?? '';
    if (!incomingHtml && !value?.doc) return;
    if (incomingHtml === lastExternal.current) return;
    lastExternal.current = incomingHtml;
    editor.commands.setContent(value?.doc ?? EMPTY_DOC, { emitUpdate: false });
  }, [editor, value?.doc, value?.html]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  /** 上传图片：走附件中心接口，落库的是相对直链（服务端保存时会发布成 public） */
  const uploadFile = async (file: File) => {
    if (!editor) return;
    try {
      const { uploadAttachment } = await import('@/services/system/api');
      const record = await uploadAttachment(file, 'product_description');
      editor
        .chain()
        .focus()
        .setImage({ src: `${PUBLIC_ATTACHMENT_PREFIX}${record.id}` })
        .run();
    } catch (error) {
      message.error((error as Error)?.message || '图片上传失败');
    }
  };

  if (!editor) {
    return (
      <div style={{ minHeight, padding: 16 }}>
        <AntTypography.Text type="secondary">编辑器加载中…</AntTypography.Text>
      </div>
    );
  }

  return (
    <div className="rich-text-editor" data-testid="rich-text-editor">
      <RichTextToolbar
        editor={editor}
        onPickImage={() => setImageOpen(true)}
        characters={editor.storage.characterCount?.characters?.() ?? 0}
      />
      <EditorContent editor={editor} />
      <AttachmentPicker
        open={imageOpen}
        title="插入图片"
        category="image"
        onCancel={() => setImageOpen(false)}
        onSelect={(record) => {
          setImageOpen(false);
          editor
            .chain()
            .focus()
            .setImage({ src: `${PUBLIC_ATTACHMENT_PREFIX}${record.id}` })
            .run();
        }}
      />
    </div>
  );
}
