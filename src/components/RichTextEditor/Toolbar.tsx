import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  BgColorsOutlined,
  BoldOutlined,
  ClearOutlined,
  CodeOutlined,
  DeleteColumnOutlined,
  DeleteOutlined,
  DeleteRowOutlined,
  FontColorsOutlined,
  HighlightOutlined,
  ItalicOutlined,
  LinkOutlined,
  MenuOutlined,
  MinusOutlined,
  OrderedListOutlined,
  PictureOutlined,
  RedoOutlined,
  StrikethroughOutlined,
  TableOutlined,
  UnderlineOutlined,
  UndoOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import type { Editor } from '@tiptap/react';
import {
  Button,
  ColorPicker,
  Divider,
  Dropdown,
  Popover,
  Space,
  Tooltip,
  Typography,
} from 'antd';

/**
 * 富文本工具栏（antd 组件自建，不引第三方 UI 包）。
 *
 * 能力与后端白名单一一对应：多出来的按钮 = 存不下来的坑，少一个 = 功能缺失。
 * 后端 `services/rich_text.py` 的 ALLOWED_TAGS / ALLOWED_STYLE_PROPERTIES 是这份清单的对照表。
 */

const HeadingMenu = ({ editor }: { editor: Editor }) => (
  <Dropdown
    menu={{
      items: [1, 2, 3, 4].map((level) => ({
        key: String(level),
        label: `标题 ${level}`,
        onClick: () =>
          editor
            .chain()
            .focus()
            .toggleHeading({ level: level as 1 | 2 | 3 | 4 })
            .run(),
      })),
    }}
  >
    <Button type="text" icon={<MenuOutlined />}>
      标题
    </Button>
  </Dropdown>
);

export default function RichTextToolbar({
  editor,
  onPickImage,
  characters,
}: {
  editor: Editor;
  onPickImage: () => void;
  characters: number;
}) {
  const btn = (
    key: string,
    icon: React.ReactNode,
    title: string,
    active: boolean,
    onClick: () => void,
    disabled = false,
  ) => (
    <Tooltip key={key} title={title}>
      <Button
        size="small"
        type={active ? 'primary' : 'text'}
        icon={icon}
        disabled={disabled}
        onClick={onClick}
      />
    </Tooltip>
  );

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 2,
        padding: '6px 8px',
        borderBottom: '1px solid var(--ant-color-border-secondary)',
        background: 'var(--ant-color-fill-quaternary)',
      }}
      data-testid="rich-text-toolbar"
    >
      {btn(
        'undo',
        <UndoOutlined />,
        '撤销',
        false,
        () => editor.chain().focus().undo().run(),
        !editor.can().undo(),
      )}
      {btn(
        'redo',
        <RedoOutlined />,
        '重做',
        false,
        () => editor.chain().focus().redo().run(),
        !editor.can().redo(),
      )}

      <Divider orientation="vertical" />

      <HeadingMenu editor={editor} />

      {btn('bold', <BoldOutlined />, '加粗', editor.isActive('bold'), () =>
        editor.chain().focus().toggleBold().run(),
      )}
      {btn(
        'italic',
        <ItalicOutlined />,
        '斜体',
        editor.isActive('italic'),
        () => editor.chain().focus().toggleItalic().run(),
      )}
      {btn(
        'underline',
        <UnderlineOutlined />,
        '下划线',
        editor.isActive('underline'),
        () => editor.chain().focus().toggleUnderline().run(),
      )}
      {btn(
        'strike',
        <StrikethroughOutlined />,
        '删除线',
        editor.isActive('strike'),
        () => editor.chain().focus().toggleStrike().run(),
      )}
      {btn('code', <CodeOutlined />, '行内代码', editor.isActive('code'), () =>
        editor.chain().focus().toggleCode().run(),
      )}

      <Divider orientation="vertical" />

      {/* 颜色 / 高亮 / 字号：都落在行内 style 上，后端白名单已放行这几个属性 */}
      <Popover
        trigger="click"
        content={
          <Space orientation="vertical">
            <Space>
              <Typography.Text style={{ fontSize: 12 }}>
                文字颜色
              </Typography.Text>
              <ColorPicker
                value={
                  (editor.getAttributes('textStyle').color as string) ||
                  '#000000'
                }
                onChange={(color) =>
                  editor.chain().focus().setColor(color.toHexString()).run()
                }
              />
            </Space>
            <Space>
              <Typography.Text style={{ fontSize: 12 }}>字号</Typography.Text>
              <Dropdown
                menu={{
                  items: [
                    '12px',
                    '14px',
                    '16px',
                    '18px',
                    '20px',
                    '24px',
                    '28px',
                  ].map((size) => ({
                    key: size,
                    label: size,
                    onClick: () =>
                      editor.chain().focus().setFontSize(size).run(),
                  })),
                }}
              >
                <Button size="small">
                  {editor.getAttributes('textStyle').fontSize || '默认'}
                </Button>
              </Dropdown>
            </Space>
            <Space>
              <Typography.Text style={{ fontSize: 12 }}>行高</Typography.Text>
              <Dropdown
                menu={{
                  items: ['1.5', '1.75', '2'].map((value) => ({
                    key: value,
                    label: value,
                    onClick: () =>
                      editor.chain().focus().setLineHeight(value).run(),
                  })),
                }}
              >
                <Button size="small">
                  {editor.getAttributes('textStyle').lineHeight || '默认'}
                </Button>
              </Dropdown>
            </Space>
          </Space>
        }
      >
        <Button size="small" type="text" icon={<FontColorsOutlined />} />
      </Popover>

      {btn(
        'highlight',
        <HighlightOutlined />,
        '背景高亮',
        editor.isActive('highlight'),
        () => editor.chain().focus().toggleHighlight().run(),
      )}

      <Popover
        trigger="click"
        content={
          <ColorPicker
            value={'#ffff00'}
            onChange={(color) =>
              editor
                .chain()
                .focus()
                .toggleHighlight({ color: color.toHexString() })
                .run()
            }
          />
        }
      >
        <Button size="small" type="text" icon={<BgColorsOutlined />} />
      </Popover>

      <Divider orientation="vertical" />

      {btn(
        'left',
        <AlignLeftOutlined />,
        '左对齐',
        editor.isActive({ textAlign: 'left' }),
        () => editor.chain().focus().setTextAlign('left').run(),
      )}
      {btn(
        'center',
        <AlignCenterOutlined />,
        '居中',
        editor.isActive({ textAlign: 'center' }),
        () => editor.chain().focus().setTextAlign('center').run(),
      )}
      {btn(
        'right',
        <AlignRightOutlined />,
        '右对齐',
        editor.isActive({ textAlign: 'right' }),
        () => editor.chain().focus().setTextAlign('right').run(),
      )}
      {btn(
        'justify',
        <AlignLeftOutlined rotate={180} />,
        '两端对齐',
        editor.isActive({ textAlign: 'justify' }),
        () => editor.chain().focus().setTextAlign('justify').run(),
      )}

      <Divider orientation="vertical" />

      {btn(
        'bullet',
        <UnorderedListOutlined />,
        '无序列表',
        editor.isActive('bulletList'),
        () => editor.chain().focus().toggleBulletList().run(),
      )}
      {btn(
        'ordered',
        <OrderedListOutlined />,
        '有序列表',
        editor.isActive('orderedList'),
        () => editor.chain().focus().toggleOrderedList().run(),
      )}
      {btn(
        'quote',
        <CodeOutlined />,
        '引用',
        editor.isActive('blockquote'),
        () => editor.chain().focus().toggleBlockquote().run(),
      )}
      {btn('hr', <MinusOutlined />, '分割线', false, () =>
        editor.chain().focus().setHorizontalRule().run(),
      )}

      <Divider orientation="vertical" />

      <Tooltip title="链接">
        <Button
          size="small"
          type={editor.isActive('link') ? 'primary' : 'text'}
          icon={<LinkOutlined />}
          onClick={() => {
            const previous =
              (editor.getAttributes('link').href as string) || '';
            const url = window.prompt('输入链接地址（留空则移除）', previous);
            if (url === null) return;
            if (!url.trim()) {
              editor.chain().focus().extendMarkRange('link').unsetLink().run();
              return;
            }
            if (!/^https?:\/\//i.test(url.trim())) {
              window.alert('只允许 http(s) 链接');
              return;
            }
            editor
              .chain()
              .focus()
              .extendMarkRange('link')
              .setLink({ href: url.trim() })
              .run();
          }}
        />
      </Tooltip>

      {btn('image', <PictureOutlined />, '插入图片', false, onPickImage)}

      <Popover
        trigger="click"
        content={
          <Space orientation="vertical">
            <Button
              size="small"
              icon={<TableOutlined />}
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                  .run()
              }
            >
              插入表格
            </Button>
            <Space wrap>
              <Button
                size="small"
                onClick={() => editor.chain().focus().addColumnAfter().run()}
              >
                加列
              </Button>
              <Button
                size="small"
                onClick={() => editor.chain().focus().addRowAfter().run()}
              >
                加行
              </Button>
              <Button
                size="small"
                icon={<DeleteColumnOutlined />}
                onClick={() => editor.chain().focus().deleteColumn().run()}
              >
                删列
              </Button>
              <Button
                size="small"
                icon={<DeleteRowOutlined />}
                onClick={() => editor.chain().focus().deleteRow().run()}
              >
                删行
              </Button>
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => editor.chain().focus().deleteTable().run()}
              >
                删表
              </Button>
            </Space>
          </Space>
        }
      >
        <Button size="small" type="text" icon={<TableOutlined />} />
      </Popover>

      <Divider orientation="vertical" />

      {btn('clear', <ClearOutlined />, '清除格式', false, () =>
        editor.chain().focus().unsetAllMarks().clearNodes().run(),
      )}

      <div style={{ marginLeft: 'auto' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {characters} 字
        </Typography.Text>
      </div>
    </div>
  );
}
