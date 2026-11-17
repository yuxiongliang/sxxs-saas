import {
  DeleteOutlined,
  EditOutlined,
  MessageOutlined,
  PictureOutlined,
  RollbackOutlined,
  SearchOutlined,
  SendOutlined,
  SmileOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@umijs/max';
import {
  App,
  Badge,
  Button,
  Card,
  Empty,
  Image,
  Input,
  List,
  Popconfirm,
  Popover,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import AttachmentPicker from '@/components/AttachmentPicker';
import {
  listPublicProducts,
  listSellerProducts,
} from '@/services/commerce/api';
import {
  editMessage,
  getReadState,
  hideConversation,
  listConversations,
  listMessages,
  markConversationRead,
  recallMessage,
  searchIm,
  sendMediaMessage,
  sendMessage,
  sendProductMessage,
} from '@/services/im/api';
import type { ConversationRecord, MessageRecord } from '@/services/im/types';
import { uploadAttachment } from '@/services/system/api';

// 与后端 `services/im.py` 的窗口保持一致：撤回 2 分钟、编辑 15 分钟。
// 前端只负责「超时就不展示按钮」，真正的判定仍以服务端为准。
const RECALL_WINDOW_MS = 2 * 60 * 1000;
const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** 消息是否还在允许操作的时间窗内；没有 `created_at`（老数据）时保守地当作超时。 */
function withinWindow(createdAt: string | null | undefined, windowMs: number) {
  if (!createdAt) return false;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return false;
  return Date.now() - created <= windowMs;
}

const EMOJIS = [
  '😀',
  '😄',
  '😁',
  '😆',
  '😅',
  '😂',
  '🙂',
  '😉',
  '😊',
  '😍',
  '😘',
  '😜',
  '🤔',
  '😐',
  '😑',
  '😴',
  '😷',
  '🤒',
  '😭',
  '😡',
  '👍',
  '👎',
  '👌',
  '🙏',
  '💪',
  '👏',
  '🎉',
  '❤️',
  '💔',
  '⭐',
];

/**
 * 即时沟通（买家中心 / 卖家中心 / 控制台消息中心**共用一套**）。
 *
 * 能力：文本、emoji、图片、视频、**商品卡片**、搜索（会话 + 消息内容）、
 * 软删会话（只影响自己）、**撤回/编辑自己的消息**。
 *
 * 商品卡片的作用域（产品口径）：
 * - 卖家只能发**自己的**商品；
 * - 买家只能发**当前会话卖家**的在售商品（服务端会用 `product.seller_id` 再校验一次）。
 */
export default function ImChat({
  mode,
  height = 560,
}: {
  /** buyer：买家视角（挑会话卖家的商品）；seller：卖家视角（挑自己的商品） */
  mode: 'buyer' | 'seller';
  height?: number;
}) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number>();
  const [input, setInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [searchResult, setSearchResult] = useState<{
    conversations: number[];
    messages: Array<{ id: number; conversation_id: number; content: string }>;
  }>();
  const [picker, setPicker] = useState<'image' | 'video' | 'product'>();
  const [editing, setEditing] = useState<MessageRecord>();
  const bottomRef = useRef<HTMLDivElement>(null);

  const conversations = useQuery({
    queryKey: ['im-conversations'],
    queryFn: listConversations,
    refetchInterval: 4000,
  });

  useEffect(() => {
    if (!selectedId && conversations.data?.length) {
      setSelectedId(conversations.data[0].id);
    }
  }, [conversations.data, selectedId]);

  const current: ConversationRecord | undefined = useMemo(
    () => conversations.data?.find((item) => item.id === selectedId),
    [conversations.data, selectedId],
  );

  const messages = useQuery({
    queryKey: ['im-messages', selectedId],
    queryFn: () => listMessages(selectedId as number),
    enabled: Boolean(selectedId),
    refetchInterval: 3000,
  });

  const readState = useQuery({
    queryKey: ['im-read-state', selectedId],
    queryFn: () => getReadState(selectedId as number),
    enabled: Boolean(selectedId),
    refetchInterval: 5000,
  });

  // 打开会话即把「已读」推到最新，清掉未读角标
  useEffect(() => {
    if (!selectedId || !messages.data?.length) return;
    const lastSeq = messages.data[messages.data.length - 1].seq;
    if (lastSeq <= (readState.data?.my_last_read_seq ?? 0)) return;
    markConversationRead(selectedId, lastSeq)
      .then(() =>
        queryClient.invalidateQueries({ queryKey: ['im-conversations'] }),
      )
      .catch(() => undefined);
  }, [
    selectedId,
    messages.data,
    readState.data?.my_last_read_seq,
    queryClient,
  ]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.data]);

  /** 会话对端名字：买家看到卖家店铺名，卖家看到买家用户名 */
  const peerName = (item: ConversationRecord) =>
    mode === 'seller'
      ? item.buyer_username || `买家 #${item.buyer_id}`
      : item.seller_name || item.seller_username || `卖家 #${item.seller_id}`;

  const unreadOf = (item: ConversationRecord) =>
    mode === 'seller' ? item.seller_unread_count : item.buyer_unread_count;

  /** 2 分钟内才能撤回（超时不显示按钮） */
  const canRecall = (item: MessageRecord) =>
    !item.recalled_at && withinWindow(item.created_at, RECALL_WINDOW_MS);

  /** 15 分钟内、且只能编辑文本消息 */
  const canEdit = (item: MessageRecord) =>
    item.type === 'text' &&
    !item.recalled_at &&
    withinWindow(item.created_at, EDIT_WINDOW_MS);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['im-messages'] });
    queryClient.invalidateQueries({ queryKey: ['im-conversations'] });
  };

  const handleSendText = async () => {
    if (!selectedId || !input.trim()) return;
    try {
      await sendMessage(selectedId, input.trim(), `web-${Date.now()}`);
      setInput('');
      refreshAll();
    } catch (error) {
      message.error((error as Error)?.message || '发送失败');
    }
  };

  const _handleUpload = async (file: File, kind: 'image' | 'video') => {
    if (!selectedId) return;
    try {
      const attachment = await uploadAttachment(file, 'im');
      await sendMediaMessage(
        selectedId,
        kind,
        attachment.id,
        `${kind}-${Date.now()}`,
      );
      refreshAll();
    } catch (error) {
      message.error((error as Error)?.message || '发送失败');
    }
  };

  const handleSearch = async (value: string) => {
    const needle = value.trim();
    if (!needle) {
      setSearchResult(undefined);
      return;
    }
    try {
      setSearchResult(await searchIm(needle));
    } catch (error) {
      message.error((error as Error)?.message || '搜索失败');
    }
  };

  const visibleConversations = searchResult
    ? (conversations.data ?? []).filter((item) =>
        searchResult.conversations.includes(item.id),
      )
    : (conversations.data ?? []);

  return (
    <div style={{ display: 'flex', gap: 12, height }} data-testid="im-chat">
      {/* ---------------- 会话列表 ---------------- */}
      <Card
        size="small"
        style={{
          width: 260,
          flex: '0 0 auto',
          display: 'flex',
          flexDirection: 'column',
        }}
        styles={{ body: { padding: 0, flex: 1, overflowY: 'auto' } }}
        title={
          <Input
            allowClear
            size="small"
            prefix={<SearchOutlined />}
            placeholder="搜会话 / 消息内容"
            onChange={(event) => {
              setKeyword(event.target.value);
              if (!event.target.value) setSearchResult(undefined);
            }}
            onPressEnter={() => handleSearch(keyword)}
          />
        }
      >
        {visibleConversations.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="还没有会话"
            style={{ padding: 24 }}
          />
        ) : (
          visibleConversations.map((item) => (
            <div
              key={item.id}
              data-testid={`im-conversation-${item.id}`}
              onClick={() => setSelectedId(item.id)}
              style={{
                cursor: 'pointer',
                padding: '10px 12px',
                borderBottom: '1px solid var(--ant-color-border-secondary)',
                background:
                  selectedId === item.id
                    ? 'var(--ant-color-primary-bg)'
                    : undefined,
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <Typography.Text ellipsis style={{ display: 'block' }}>
                  {peerName(item)}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  会话 #{item.id}
                </Typography.Text>
              </div>
              <Space size={4}>
                <Badge count={unreadOf(item)} size="small" />
                <Popconfirm
                  title="删除这个会话？"
                  description="只从你的列表移除，对方那边还在；有新消息会重新出现"
                  onConfirm={async (event) => {
                    event?.stopPropagation();
                    await hideConversation(item.id);
                    message.success('会话已删除');
                    if (selectedId === item.id) setSelectedId(undefined);
                    queryClient.invalidateQueries({
                      queryKey: ['im-conversations'],
                    });
                  }}
                >
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    data-testid={`im-hide-${item.id}`}
                    onClick={(event) => event.stopPropagation()}
                  />
                </Popconfirm>
              </Space>
            </div>
          ))
        )}
      </Card>

      {/* ---------------- 消息区 ---------------- */}
      <Card
        size="small"
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
        styles={{
          body: {
            padding: 0,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
          },
        }}
        title={
          current ? (
            <Space>
              <MessageOutlined />
              {peerName(current)}
            </Space>
          ) : (
            '选择会话'
          )
        }
      >
        {!selectedId ? (
          <Empty description="从左侧选择一个会话" style={{ margin: 'auto' }} />
        ) : (
          <>
            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
              {searchResult?.messages.length ? (
                <Card
                  size="small"
                  style={{ marginBottom: 12 }}
                  title="搜索到的消息"
                >
                  <List
                    size="small"
                    dataSource={searchResult.messages}
                    renderItem={(item) => (
                      <List.Item
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          setSelectedId(item.conversation_id);
                          setSearchResult(undefined);
                        }}
                      >
                        <Typography.Text ellipsis style={{ maxWidth: 480 }}>
                          {item.content}
                        </Typography.Text>
                      </List.Item>
                    )}
                  />
                </Card>
              ) : null}

              {(messages.data ?? []).map((item) => {
                const mine =
                  item.sender_id === current?.buyer_id
                    ? mode === 'buyer'
                    : mode === 'seller';
                return (
                  <div
                    key={item.id}
                    data-testid={`im-message-${item.id}`}
                    style={{
                      display: 'flex',
                      justifyContent: mine ? 'flex-end' : 'flex-start',
                      marginBottom: 10,
                    }}
                  >
                    <div style={{ maxWidth: '72%' }}>
                      <div
                        style={{ marginBottom: 2, fontSize: 12, opacity: 0.6 }}
                      >
                        {mine ? '我' : peerName(current as ConversationRecord)}
                        {item.edited_at ? '（已编辑）' : ''}
                      </div>
                      {item.recalled_at ? (
                        <Tag>该消息已撤回</Tag>
                      ) : item.type === 'product' ? (
                        <ProductBubble payload={item.payload} />
                      ) : item.type === 'image' ? (
                        <Image
                          src={item.payload?.url}
                          width={160}
                          style={{ borderRadius: 6 }}
                        />
                      ) : item.type === 'video' ? (
                        // biome-ignore lint/a11y/useMediaCaption: 用户上传的视频没有字幕轨，补假 <track> 反而误导
                        <video
                          src={item.payload?.url}
                          style={{ width: 220, borderRadius: 6 }}
                          controls
                        />
                      ) : (
                        <div
                          style={{
                            padding: '8px 12px',
                            borderRadius: 8,
                            background: mine
                              ? 'var(--ant-color-primary-bg)'
                              : 'var(--ant-color-fill-secondary)',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {item.content}
                        </div>
                      )}
                      {mine &&
                      !item.recalled_at &&
                      (canEdit(item) || canRecall(item)) ? (
                        <Space
                          size={4}
                          style={{
                            justifyContent: 'flex-end',
                            display: 'flex',
                          }}
                        >
                          {item.type === 'text' && canEdit(item) ? (
                            <Button
                              size="small"
                              type="link"
                              icon={<EditOutlined />}
                              data-testid={`im-edit-${item.id}`}
                              onClick={() => {
                                setEditing(item);
                                setInput(item.content);
                              }}
                            >
                              编辑
                            </Button>
                          ) : null}
                          {/* 撤回只在 2 分钟窗口内出现：超时后不显示按钮，
                              避免“点了才报错”的交互（服务端仍有同样校验兜底） */}
                          {canRecall(item) ? (
                            <Popconfirm
                              title="撤回这条消息？"
                              description="2 分钟内可撤回，撤回后双方都看不到内容"
                              onConfirm={async () => {
                                try {
                                  await recallMessage(item.id);
                                  message.success('已撤回');
                                  refreshAll();
                                } catch (error) {
                                  message.error(
                                    (error as Error)?.message || '撤回失败',
                                  );
                                }
                              }}
                            >
                              <Button
                                size="small"
                                type="link"
                                danger
                                icon={<RollbackOutlined />}
                                data-testid={`im-recall-${item.id}`}
                              >
                                撤回
                              </Button>
                            </Popconfirm>
                          ) : null}
                        </Space>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* ---------------- 输入区 ---------------- */}
            <div
              style={{
                borderTop: '1px solid var(--ant-color-border-secondary)',
                padding: 8,
              }}
            >
              <Space wrap size={4} style={{ marginBottom: 8 }}>
                <Popover
                  trigger="click"
                  title="表情"
                  content={
                    <div
                      style={{
                        width: 260,
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 4,
                      }}
                    >
                      {EMOJIS.map((emoji) => (
                        <Button
                          key={emoji}
                          size="small"
                          type="text"
                          onClick={() => setInput((prev) => prev + emoji)}
                        >
                          {emoji}
                        </Button>
                      ))}
                    </div>
                  }
                >
                  <Button
                    size="small"
                    icon={<SmileOutlined />}
                    data-testid="im-emoji"
                  >
                    表情
                  </Button>
                </Popover>
                <Button
                  size="small"
                  icon={<PictureOutlined />}
                  onClick={() => setPicker('image')}
                >
                  图片
                </Button>
                <Button
                  size="small"
                  icon={<VideoCameraOutlined />}
                  onClick={() => setPicker('video')}
                >
                  视频
                </Button>
                <Button
                  size="small"
                  icon={<MessageOutlined />}
                  data-testid="im-product"
                  onClick={() => setPicker('product')}
                >
                  商品卡片
                </Button>
                {editing ? (
                  <Tag
                    color="orange"
                    closable
                    onClose={() => setEditing(undefined)}
                  >
                    正在编辑消息
                  </Tag>
                ) : null}
              </Space>
              <Input.TextArea
                rows={2}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onPressEnter={(event) => {
                  if (event.shiftKey) return;
                  event.preventDefault();
                  if (editing) {
                    void (async () => {
                      try {
                        await editMessage(editing.id, input.trim());
                        message.success('已更新');
                        setEditing(undefined);
                        setInput('');
                        refreshAll();
                      } catch (error) {
                        message.error((error as Error)?.message || '编辑失败');
                      }
                    })();
                  } else {
                    void handleSendText();
                  }
                }}
                placeholder={
                  editing
                    ? '修改后按 Enter 保存'
                    : '输入消息，Enter 发送（Shift+Enter 换行）'
                }
              />
              <div style={{ textAlign: 'right', marginTop: 6 }}>
                <Button
                  type="primary"
                  size="small"
                  icon={<SendOutlined />}
                  data-testid="im-send"
                  onClick={() => {
                    if (editing) {
                      void (async () => {
                        try {
                          await editMessage(editing.id, input.trim());
                          message.success('已更新');
                          setEditing(undefined);
                          setInput('');
                          refreshAll();
                        } catch (error) {
                          message.error(
                            (error as Error)?.message || '编辑失败',
                          );
                        }
                      })();
                    } else {
                      void handleSendText();
                    }
                  }}
                >
                  {editing ? '保存' : '发送'}
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* 图片 / 视频：选完直接上传发送 */}
      <AttachmentPicker
        open={picker === 'image' || picker === 'video'}
        title={picker === 'video' ? '选择视频' : '选择图片'}
        category={picker === 'video' ? 'video' : 'image'}
        onCancel={() => setPicker(undefined)}
        onSelect={async (record) => {
          const kind = picker === 'video' ? 'video' : 'image';
          setPicker(undefined);
          if (!selectedId) return;
          try {
            await sendMediaMessage(
              selectedId,
              kind,
              record.id,
              `${kind}-${Date.now()}`,
            );
            refreshAll();
          } catch (error) {
            message.error((error as Error)?.message || '发送失败');
          }
        }}
      />

      <ProductPicker
        open={picker === 'product'}
        mode={mode}
        sellerId={current?.seller_id}
        onCancel={() => setPicker(undefined)}
        onPick={async (productId) => {
          setPicker(undefined);
          if (!selectedId) return;
          try {
            await sendProductMessage(selectedId, productId, `pd-${Date.now()}`);
            refreshAll();
          } catch (error) {
            message.error((error as Error)?.message || '发送失败');
          }
        }}
      />
    </div>
  );
}

/** 商品卡片气泡：用发送时的快照渲染，商品后来改名/下架也不影响历史消息。 */
function ProductBubble({ payload }: { payload?: MessageRecord['payload'] }) {
  const snapshot = payload?.snapshot;
  if (!snapshot) return <Tag>商品卡片</Tag>;
  return (
    <Link to={`/products/${payload?.product_id}`}>
      <Card size="small" style={{ width: 240 }} hoverable>
        <Space size={8} align="start">
          {snapshot.image ? (
            <img
              src={snapshot.image}
              alt={snapshot.name}
              style={{
                width: 48,
                height: 48,
                objectFit: 'cover',
                borderRadius: 4,
              }}
            />
          ) : null}
          <div style={{ minWidth: 0 }}>
            <Typography.Text
              ellipsis
              style={{ display: 'block', maxWidth: 150 }}
            >
              {snapshot.name}
            </Typography.Text>
            <Typography.Text type="danger">
              {snapshot.price_cents == null
                ? '—'
                : `¥${(snapshot.price_cents / 100).toFixed(2)}`}
            </Typography.Text>
          </div>
        </Space>
      </Card>
    </Link>
  );
}

/**
 * 选商品发卡片。
 *
 * 作用域：卖家只能选自己的商品；买家只能选**当前会话卖家**的在售商品——
 * 服务端还会用 `product.seller_id` 再拦一次，前端这里只是少给错误选项。
 */
function ProductPicker({
  open,
  mode,
  sellerId,
  onCancel,
  onPick,
}: {
  open: boolean;
  mode: 'buyer' | 'seller';
  sellerId?: number;
  onCancel: () => void;
  onPick: (productId: number) => void;
}) {
  const products = useQuery({
    queryKey: ['im-product-picker', mode, sellerId],
    enabled: open,
    queryFn: async () => {
      if (mode === 'seller') {
        const rows = await listSellerProducts();
        return rows
          .filter((item) => item.status === 'on_sale')
          .map((item) => ({
            id: item.id,
            name: item.name,
            price: item.price_cents,
            image: item.main_image,
          }));
      }
      if (!sellerId) return [];
      const page = await listPublicProducts({
        seller_id: sellerId,
        page_size: 50,
      });
      return page.list.map((item) => ({
        id: item.id,
        name: item.name,
        price: item.price_min_cents ?? null,
        image: item.main_image,
      }));
    },
  });

  if (!open) return null;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1050,
      }}
      onClick={onCancel}
    >
      <Card
        title="选择商品发送"
        style={{ width: 520, maxHeight: '70vh', overflowY: 'auto' }}
        onClick={(event) => event.stopPropagation()}
        extra={<Button onClick={onCancel}>取消</Button>}
      >
        {products.isLoading ? (
          <Typography.Text type="secondary">加载中…</Typography.Text>
        ) : (products.data ?? []).length === 0 ? (
          <Empty description="没有可发送的在售商品" />
        ) : (
          <List
            size="small"
            dataSource={products.data ?? []}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Button
                    key="send"
                    size="small"
                    type="link"
                    data-testid={`im-pick-product-${item.id}`}
                    onClick={() => onPick(item.id)}
                  >
                    发送
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  avatar={
                    item.image ? (
                      <img
                        src={item.image}
                        alt={item.name}
                        style={{
                          width: 40,
                          height: 40,
                          objectFit: 'cover',
                          borderRadius: 4,
                        }}
                      />
                    ) : null
                  }
                  title={item.name}
                  description={
                    item.price == null
                      ? '—'
                      : `¥${(item.price / 100).toFixed(2)}`
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>
    </div>
  );
}
