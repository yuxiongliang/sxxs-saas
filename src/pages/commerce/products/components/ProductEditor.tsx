import { LeftOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import {
  App,
  Button,
  Divider,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Typography,
} from 'antd';
import React, { useEffect, useMemo, useState } from 'react';
import AttachmentPicker from '@/components/AttachmentPicker';
import MediaField from '@/components/MediaField';
import type { RichTextValue } from '@/components/RichTextEditor';
import RichTextEditor from '@/components/RichTextEditor';
import {
  getAdminProduct,
  listAdminCategories,
  unlockAdminProductCommission,
  updateAdminProduct,
  updateAdminProductSpecs,
} from '@/services/commerce/api';
import type { CategoryRecord, ProductRecord } from '@/services/commerce/types';
import { buildCombos, comboKey, resolveMedia } from './specUtils';

/** 草稿里的规格组/规格值（带本地 key，便于增删） */
interface DraftValue {
  key: string;
  value: string;
  image_url?: string | null;
  video_url?: string | null;
}
interface DraftGroup {
  key: string;
  name: string;
  values: DraftValue[];
}

interface SkuDraft {
  price_yuan: number;
  stock: number;
  image_url?: string | null;
  video_url?: string | null;
}

const uid = () => Math.random().toString(36).slice(2, 9);
const MAX_GROUPS = 3;

type PickerTarget =
  | { kind: 'sku_image'; comboKey: string }
  | {
      kind: 'spec';
      groupKey: string;
      valueKey: string;
      media: 'image' | 'video';
    };

interface ProductEditorProps {
  open: boolean;
  productId?: number;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * 商品编辑：两步（基础信息 / 规格）。
 *
 * 规格用「规格组 → 规格值」两级输入，保存时由后端做笛卡尔积生成 SKU；
 * 每个规格值可挂 1 图或 1 视频，SKU 还能再挂一层覆盖图（优先级最高）。
 * 展示区：**滑动切组合**（左右箭头/触摸滑动），点缩略图切当前组合的图。
 */
export default function ProductEditor({
  open,
  productId,
  onClose,
  onSaved,
}: ProductEditorProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [step, setStep] = useState(0);
  const [detail, setDetail] = useState<ProductRecord>();
  const [groups, setGroups] = useState<DraftGroup[]>([]);
  const [skuDraft, setSkuDraft] = useState<Record<string, SkuDraft>>({});
  const [activeKey, setActiveKey] = useState<string>('__default__');
  const [previewOverride, setPreviewOverride] = useState<string>();
  const [picker, setPicker] = useState<PickerTarget>();
  const [saving, setSaving] = useState(false);
  // 富文本详情：单独存 state（不是 Form 字段）—— 它是个重组件，走 Form 受控反而麻烦
  const [richText, setRichText] = useState<RichTextValue | null>(null);
  const [richLoaded, setRichLoaded] = useState(false);

  const [categoryList, setCategoryList] = useState<CategoryRecord[]>([]);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setPreviewOverride(undefined);
    listAdminCategories()
      .then(setCategoryList)
      .catch(() => setCategoryList([]));
  }, [open]);

  useEffect(() => {
    if (!open || !productId) return;
    getAdminProduct(productId)
      .then((data) => {
        setDetail(data);
        // 富文本回显：doc 优先，没有 doc 就把历史纯文本包成一段段落展示
        setRichText(
          data.description_format === 'doc' && data.description_doc
            ? {
                doc: data.description_doc as Record<string, unknown>,
                html: data.description_html ?? '',
              }
            : null,
        );
        setRichLoaded(true);
        form.setFieldsValue({
          name: data.name,
          description: data.description ?? '',
          category_id: data.category_id ?? undefined,
          main_image: data.main_image ?? '',
          video_url: data.video_url ?? '',
          commission_percent:
            data.commission_bps === null || data.commission_bps === undefined
              ? undefined
              : data.commission_bps / 100,
        });
        const draft: DraftGroup[] = (data.spec_groups ?? []).map((group) => ({
          key: uid(),
          name: group.name,
          values: group.values.map((value) => ({
            key: uid(),
            value: value.value,
            image_url: value.image_url,
            video_url: value.video_url,
          })),
        }));
        setGroups(draft);
        const nextDraft: Record<string, SkuDraft> = {};
        for (const sku of data.skus ?? []) {
          if (sku.status === 'inactive') continue;
          nextDraft[comboKey(sku.specs ?? {})] = {
            price_yuan: sku.price_cents / 100,
            stock: sku.stock,
            image_url: sku.image_url,
            video_url: sku.video_url,
          };
        }
        setSkuDraft(nextDraft);
        setActiveKey(
          comboKey((data.skus?.[0]?.specs as Record<string, string>) ?? {}),
        );
      })
      .catch((error: Error) => message.error(error.message));
  }, [open, productId, form, message]);

  const combos = useMemo(() => buildCombos(groups), [groups]);
  const activeCombo = useMemo(
    () => combos.find((combo) => comboKey(combo) === activeKey) ?? combos[0],
    [combos, activeKey],
  );

  const activeSku = skuDraft[comboKey(activeCombo ?? {})];
  // 取图优先级与买家端一致（SKU 覆盖 > 规格值图 > 商品主图），逻辑在 specUtils 里共用
  const mainMedia = previewOverride
    ? { url: previewOverride, isVideo: false }
    : resolveMedia({
        skuImage: activeSku?.image_url,
        skuVideo: activeSku?.video_url,
        groups,
        selected: activeCombo ?? {},
        mainImage: detail?.main_image,
      });

  const thumbnails = useMemo(() => {
    const urls = new Set<string>();
    if (detail?.main_image) urls.add(detail.main_image);
    for (const image of detail?.images ?? []) urls.add(image);
    for (const group of groups) {
      for (const value of group.values)
        if (value.image_url) urls.add(value.image_url);
    }
    for (const draft of Object.values(skuDraft)) {
      if (draft.image_url) urls.add(draft.image_url);
    }
    return [...urls];
  }, [detail, groups, skuDraft]);

  const shiftCombo = (delta: number) => {
    if (combos.length <= 1) return;
    const index = combos.findIndex((combo) => comboKey(combo) === activeKey);
    const next = combos[(index + delta + combos.length) % combos.length];
    setActiveKey(comboKey(next));
    setPreviewOverride(undefined);
  };

  const applyPicked = (url: string, _asVideo: boolean) => {
    if (!picker) return;
    const target = picker;
    setPicker(undefined);
    if (target.kind === 'sku_image') {
      setSkuDraft((prev) => ({
        ...prev,
        [target.comboKey]: {
          price_yuan: prev[target.comboKey]?.price_yuan ?? 0,
          stock: prev[target.comboKey]?.stock ?? 0,
          image_url: url,
          video_url: null,
        },
      }));
      return;
    }
    setGroups((prev) =>
      prev.map((group) =>
        group.key !== target.groupKey
          ? group
          : {
              ...group,
              values: group.values.map((value) =>
                value.key !== target.valueKey
                  ? value
                  : target.media === 'image'
                    ? { ...value, image_url: url, video_url: null }
                    : { ...value, video_url: url, image_url: null },
              ),
            },
      ),
    );
  };

  const addGroup = () => {
    if (groups.length >= MAX_GROUPS) {
      message.warning(`最多 ${MAX_GROUPS} 级规格`);
      return;
    }
    setGroups((prev) => [
      ...prev,
      { key: uid(), name: '', values: [{ key: uid(), value: '' }] },
    ]);
  };

  const handleUnlock = async () => {
    if (!productId) return;
    try {
      await unlockAdminProductCommission(productId);
      message.success('已解除锁定，卖家可自行修改佣金比例');
      const data = await getAdminProduct(productId);
      setDetail(data);
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const handleSave = async () => {
    if (!productId) return;
    try {
      const values = await form.validateFields();
      setSaving(true);
      await updateAdminProduct(productId, {
        name: values.name,
        description: values.description,
        category_id: values.category_id ?? null,
        main_image: values.main_image ?? '',
        // 视频以前根本没传，选了也白选 —— 现在一并保存
        video_url: values.video_url ?? '',
        // 富文本：doc 是真身，html 交给服务端用 nh3 重新清洗后落库
        ...(richText
          ? { description_doc: richText.doc, description_html: richText.html }
          : {}),
        ...(typeof values.commission_percent === 'number'
          ? { commission_bps: Math.round(values.commission_percent * 100) }
          : {}),
      });
      const usableGroups = groups
        .filter(
          (group) =>
            group.name.trim() && group.values.some((v) => v.value.trim()),
        )
        .map((group) => ({
          name: group.name.trim(),
          values: group.values
            .filter((value) => value.value.trim())
            .map((value) => ({
              value: value.value.trim(),
              image_url: value.image_url ?? null,
              video_url: value.video_url ?? null,
            })),
        }));
      await updateAdminProductSpecs(productId, {
        groups: usableGroups,
        skus: combos.map((combo) => {
          const draft = skuDraft[comboKey(combo)];
          return {
            specs: combo,
            price_cents: draft
              ? Math.round(Number(draft.price_yuan) * 100)
              : undefined,
            stock: draft?.stock,
            image_url: draft?.image_url ?? null,
            video_url: draft?.video_url ?? null,
          };
        }),
      });
      message.success('商品已保存');
      onSaved();
      onClose();
    } catch (error) {
      if ((error as { errorFields?: unknown }).errorFields) {
        setStep(0);
        return;
      }
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="编辑商品"
      open={open}
      onCancel={onClose}
      width={960}
      destroyOnHidden
      forceRender
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          {step === 0 ? (
            <Button type="primary" onClick={() => setStep(1)}>
              下一步：规格
            </Button>
          ) : step === 1 ? (
            <>
              <Button onClick={() => setStep(0)}>上一步</Button>
              <Button type="primary" onClick={() => setStep(2)}>
                下一步：详情
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => setStep(1)}>上一步</Button>
              <Button type="primary" loading={saving} onClick={handleSave}>
                保存
              </Button>
            </>
          )}
        </Space>
      }
    >
      <Steps
        size="small"
        current={step}
        style={{ marginBottom: 20 }}
        items={[{ title: '基础信息' }, { title: '规格' }, { title: '详情' }]}
      />

      {/*
        两步内容是「显示/隐藏」而不是「挂载/卸载」。

        以前这里是 `step === 0 ? <Form>...</Form> : <规格区/>`：切到第 2 步时
        `<Form>` 整个被卸载，antd 的字段 store 跟着没了，而「保存」按钮**只在第 2 步出现**
        —— 于是点保存时 `validateFields()` 拿不到主图/视频/名称/分类等基础字段，
        提交上去的 `main_image` 是空串，把库里的图**反而清掉了**。

        现在 Form 始终挂载，只切换可见性，字段值不会丢。
      */}
      <Form form={form} layout="vertical">
        <div style={{ display: step === 0 ? 'block' : 'none' }}>
          <Form.Item
            label="商品名称"
            name="name"
            rules={[{ required: true, message: '请输入商品名称' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item label="商品描述" name="description">
            <Input.TextArea rows={3} placeholder="卖点、成色、规格说明" />
          </Form.Item>
          <Form.Item label="商品分类" name="category_id">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="搜索或选择分类（由平台统一维护）"
              options={categoryList.map((item) => ({
                label: item.name,
                value: item.id,
              }))}
            />
          </Form.Item>
          <Form.Item
            label="卖家佣金比例（%）"
            name="commission_percent"
            extra={
              detail?.commission_locked
                ? '该比例已被运营调整并锁定，保存后卖家不自行修改；需要放开请点下方「解除锁定」'
                : '默认继承分类比例；填了就以这里为准（下限 1%）。卖家自己也能改'
            }
          >
            <InputNumber min={1} max={100} step={0.5} style={{ width: 220 }} />
          </Form.Item>
          {detail?.commission_locked ? (
            <Space style={{ marginBottom: 16 }}>
              <Tag color="orange">已锁定</Tag>
              <Button size="small" onClick={handleUnlock}>
                解除锁定
              </Button>
            </Space>
          ) : null}
          <Flex gap={24} wrap>
            <Form.Item label="主图" name="main_image" style={{ flex: 1 }}>
              <MediaField kind="image" title="选择商品主图" boxSize={104} />
            </Form.Item>
            <Form.Item
              label="商品视频（可选）"
              name="video_url"
              style={{ flex: 1 }}
            >
              <MediaField kind="video" title="选择商品视频" boxSize={104} />
            </Form.Item>
          </Flex>
        </div>
      </Form>

      <div style={{ display: step === 1 ? 'block' : 'none' }}>
        <Flex gap={16} align="flex-start">
          <div style={{ flex: 1, minWidth: 0 }}>
            <Space orientation="vertical" size={12} style={{ width: '100%' }}>
              {groups.map((group, groupIndex) => (
                <div key={group.key}>
                  <Flex gap={8} align="center">
                    <Typography.Text
                      strong
                    >{`第 ${groupIndex + 1} 级`}</Typography.Text>
                    <Input
                      placeholder="规格名，如 尺码"
                      value={group.name}
                      style={{ width: 180 }}
                      onChange={(event) =>
                        setGroups((prev) =>
                          prev.map((item) =>
                            item.key === group.key
                              ? { ...item, name: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    <Button
                      type="link"
                      danger
                      onClick={() =>
                        setGroups((prev) =>
                          prev.filter((item) => item.key !== group.key),
                        )
                      }
                    >
                      删除该级
                    </Button>
                  </Flex>
                  <Space wrap style={{ marginTop: 8, marginLeft: 56 }}>
                    {group.values.map((value) => (
                      <Tag
                        key={value.key}
                        closable
                        onClose={() =>
                          setGroups((prev) =>
                            prev.map((item) =>
                              item.key !== group.key
                                ? item
                                : {
                                    ...item,
                                    values: item.values.filter(
                                      (v) => v.key !== value.key,
                                    ),
                                  },
                            ),
                          )
                        }
                      >
                        <Input
                          size="small"
                          variant="borderless"
                          style={{ width: 90 }}
                          placeholder="规格值"
                          value={value.value}
                          onChange={(event) =>
                            setGroups((prev) =>
                              prev.map((item) =>
                                item.key !== group.key
                                  ? item
                                  : {
                                      ...item,
                                      values: item.values.map((v) =>
                                        v.key === value.key
                                          ? { ...v, value: event.target.value }
                                          : v,
                                      ),
                                    },
                              ),
                            )
                          }
                        />
                        <Button
                          size="small"
                          type="link"
                          onClick={() =>
                            setPicker({
                              kind: 'spec',
                              groupKey: group.key,
                              valueKey: value.key,
                              media: 'image',
                            })
                          }
                        >
                          {value.image_url ? '换图' : '图'}
                        </Button>
                        <Button
                          size="small"
                          type="link"
                          onClick={() =>
                            setPicker({
                              kind: 'spec',
                              groupKey: group.key,
                              valueKey: value.key,
                              media: 'video',
                            })
                          }
                        >
                          {value.video_url ? '换视频' : '视频'}
                        </Button>
                      </Tag>
                    ))}
                    <Button
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={() =>
                        setGroups((prev) =>
                          prev.map((item) =>
                            item.key !== group.key
                              ? item
                              : {
                                  ...item,
                                  values: [
                                    ...item.values,
                                    { key: uid(), value: '' },
                                  ],
                                },
                          ),
                        )
                      }
                    >
                      加规格值
                    </Button>
                  </Space>
                </div>
              ))}
              <Button icon={<PlusOutlined />} onClick={addGroup} block>
                添加规格（最多 {MAX_GROUPS} 级）
              </Button>
            </Space>

            <Divider titlePlacement="start" plain>
              组合（{combos.length} 个）
            </Divider>
            <Table
              rowKey={(combo) => comboKey(combo)}
              size="small"
              pagination={false}
              dataSource={combos}
              scroll={{ y: 220 }}
              columns={[
                {
                  title: '组合',
                  render: (_, combo) =>
                    Object.keys(combo).length
                      ? Object.values(combo).join(' / ')
                      : '默认（无规格）',
                },
                {
                  title: '价格（元）',
                  width: 140,
                  render: (_, combo) => {
                    const key = comboKey(combo);
                    return (
                      <InputNumber
                        min={0.01}
                        step={1}
                        style={{ width: '100%' }}
                        value={skuDraft[key]?.price_yuan ?? 0}
                        onChange={(value) =>
                          setSkuDraft((prev) => ({
                            ...prev,
                            [key]: {
                              price_yuan: Number(value ?? 0),
                              stock: prev[key]?.stock ?? 0,
                              image_url: prev[key]?.image_url,
                              video_url: prev[key]?.video_url,
                            },
                          }))
                        }
                      />
                    );
                  },
                },
                {
                  title: '库存',
                  width: 120,
                  render: (_, combo) => {
                    const key = comboKey(combo);
                    return (
                      <InputNumber
                        min={0}
                        style={{ width: '100%' }}
                        value={skuDraft[key]?.stock ?? 0}
                        onChange={(value) =>
                          setSkuDraft((prev) => ({
                            ...prev,
                            [key]: {
                              price_yuan: prev[key]?.price_yuan ?? 0,
                              stock: Number(value ?? 0),
                              image_url: prev[key]?.image_url,
                              video_url: prev[key]?.video_url,
                            },
                          }))
                        }
                      />
                    );
                  },
                },
                {
                  title: '覆盖图',
                  width: 110,
                  render: (_, combo) => {
                    const key = comboKey(combo);
                    return (
                      <Button
                        size="small"
                        type={skuDraft[key]?.image_url ? 'link' : 'dashed'}
                        onClick={() => {
                          setActiveKey(key);
                          setPicker({ kind: 'sku_image', comboKey: key });
                        }}
                      >
                        {skuDraft[key]?.image_url ? '已设置' : '未设置'}
                      </Button>
                    );
                  },
                },
              ]}
            />
            {detail?.inactive_sku_count ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                该商品有 {detail.inactive_sku_count}{' '}
                条已停用的历史规格（只保留给历史订单对账，不计入库存与价格）。
              </Typography.Text>
            ) : null}
          </div>

          {/* 展示区：滑动切组合，点缩略图切图 */}
          <div style={{ width: 300 }}>
            <div
              style={{
                position: 'relative',
                height: 300,
                background: 'rgba(0,0,0,0.04)',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
              onTouchStart={(event) => {
                (event.currentTarget as HTMLDivElement).dataset.startX = String(
                  event.touches[0].clientX,
                );
              }}
              onTouchEnd={(event) => {
                const startX = Number(
                  (event.currentTarget as HTMLDivElement).dataset.startX ?? 0,
                );
                const delta = event.changedTouches[0].clientX - startX;
                if (Math.abs(delta) > 40) shiftCombo(delta > 0 ? -1 : 1);
              }}
            >
              {combos.length > 1 ? (
                <>
                  <Button
                    type="text"
                    icon={<LeftOutlined />}
                    style={{ position: 'absolute', left: 4, zIndex: 2 }}
                    onClick={() => shiftCombo(-1)}
                  />
                  <Button
                    type="text"
                    icon={<RightOutlined />}
                    style={{ position: 'absolute', right: 4, zIndex: 2 }}
                    onClick={() => shiftCombo(1)}
                  />
                </>
              ) : null}
              {mainMedia?.url ? (
                mainMedia.isVideo ? (
                  // biome-ignore lint/a11y/useMediaCaption: 商品展示视频没有字幕轨，商户上传的素材也不提供 caption
                  <video
                    src={mainMedia.url}
                    controls
                    style={{ maxWidth: '100%' }}
                  />
                ) : (
                  <img
                    src={mainMedia.url}
                    alt="商品展示"
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      objectFit: 'contain',
                    }}
                  />
                )
              ) : (
                <Typography.Text type="secondary">暂无图片</Typography.Text>
              )}
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              当前组合：
              {activeCombo && Object.keys(activeCombo).length
                ? Object.values(activeCombo).join(' / ')
                : '默认'}
            </Typography.Text>
            <Flex gap={8} wrap style={{ marginTop: 8 }}>
              {thumbnails.map((url) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setPreviewOverride(url)}
                  style={{
                    width: 56,
                    height: 56,
                    padding: 0,
                    border: '1px solid #d9d9d9',
                    borderRadius: 6,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    background: '#fafafa',
                  }}
                >
                  <img
                    src={url}
                    alt="缩略图"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                </button>
              ))}
            </Flex>
          </div>
        </Flex>
      </div>

      {/* 第 3 步：富文本详情。
          同样用 display 切换而不是条件卸载 —— 卸载会丢编辑器状态（同 ② 基础信息的坑）。 */}
      <div style={{ display: step === 2 ? 'block' : 'none' }}>
        {richLoaded ? (
          <RichTextEditor
            value={richText}
            onChange={setRichText}
            placeholder="商品详情：成色、规格、配件、使用说明…（可插入图片、表格）"
            minHeight={360}
          />
        ) : (
          <div style={{ padding: 24, textAlign: 'center' }}>加载中…</div>
        )}
      </div>

      <AttachmentPicker
        open={Boolean(picker)}
        category={
          picker?.kind === 'spec' && picker.media === 'video'
            ? 'video'
            : 'image'
        }
        title={
          picker?.kind === 'spec' && picker.media === 'video'
            ? '选择视频'
            : '选择图片'
        }
        onCancel={() => setPicker(undefined)}
        onSelect={(record) =>
          applyPicked(
            `/api/v1/attachments/public/${record.id}`,
            record.category === 'video',
          )
        }
      />
    </Modal>
  );
}
