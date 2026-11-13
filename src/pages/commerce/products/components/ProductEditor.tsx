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
import {
  getAdminProduct,
  listAdminCategories,
  updateAdminProduct,
  updateAdminProductSpecs,
} from '@/services/commerce/api';
import type { CategoryRecord, ProductRecord } from '@/services/commerce/types';

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

const combosOf = (groups: DraftGroup[]): Array<Record<string, string>> => {
  const usable = groups.filter(
    (group) => group.name.trim() && group.values.length,
  );
  if (!usable.length) return [{}];
  return usable.reduce<Array<Record<string, string>>>(
    (acc, group) => {
      const next: Array<Record<string, string>> = [];
      for (const base of acc) {
        for (const value of group.values) {
          next.push({ ...base, [group.name.trim()]: value.value });
        }
      }
      return next;
    },
    [{}],
  );
};

const comboKey = (combo: Record<string, string>) =>
  Object.keys(combo)
    .sort()
    .map((key) => `${key}=${combo[key]}`)
    .join('|') || '__default__';

type PickerTarget =
  | { kind: 'main_image' }
  | { kind: 'video' }
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
        form.setFieldsValue({
          name: data.name,
          subtitle: data.subtitle ?? '',
          description: data.description ?? '',
          category_id: data.category_id ?? undefined,
          main_image: data.main_image ?? '',
          video_url: data.video_url ?? '',
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

  const combos = useMemo(() => combosOf(groups), [groups]);
  const activeCombo = useMemo(
    () => combos.find((combo) => comboKey(combo) === activeKey) ?? combos[0],
    [combos, activeKey],
  );

  const specValueMedia = useMemo(() => {
    if (!activeCombo) return undefined;
    for (const group of groups) {
      const value = group.values.find(
        (item) => item.value === activeCombo[group.name],
      );
      if (value?.image_url || value?.video_url) {
        return {
          url: value.image_url || value.video_url || '',
          isVideo: !!value.video_url,
        };
      }
    }
    return undefined;
  }, [activeCombo, groups]);

  const activeSku = skuDraft[comboKey(activeCombo ?? {})];
  const mainMedia = previewOverride
    ? { url: previewOverride, isVideo: false }
    : activeSku?.image_url || activeSku?.video_url
      ? {
          url: activeSku.image_url || activeSku.video_url || '',
          isVideo: !!activeSku.video_url,
        }
      : specValueMedia
        ? specValueMedia
        : { url: detail?.main_image ?? '', isVideo: false };

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

  const applyPicked = (url: string, asVideo: boolean) => {
    if (!picker) return;
    const target = picker;
    setPicker(undefined);
    if (target.kind === 'main_image') {
      form.setFieldValue('main_image', asVideo ? '' : url);
      return;
    }
    if (target.kind === 'video') {
      form.setFieldValue('video_url', asVideo ? url : '');
      return;
    }
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

  const handleSave = async () => {
    if (!productId) return;
    try {
      const values = await form.validateFields();
      setSaving(true);
      await updateAdminProduct(productId, {
        name: values.name,
        subtitle: values.subtitle,
        description: values.description,
        category_id: values.category_id ?? null,
        main_image: values.main_image ?? '',
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
          ) : (
            <>
              <Button onClick={() => setStep(0)}>上一步</Button>
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
        items={[{ title: '基础信息' }, { title: '规格' }]}
      />

      {step === 0 ? (
        <Form form={form} layout="vertical">
          <Form.Item
            label="商品名称"
            name="name"
            rules={[{ required: true, message: '请输入商品名称' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item label="副标题" name="subtitle">
            <Input />
          </Form.Item>
          <Form.Item label="商品描述" name="description">
            <Input.TextArea rows={3} placeholder="卖点、成色、规格说明" />
          </Form.Item>
          <Form.Item label="商品分类" name="category_id">
            <Select
              allowClear
              placeholder="请选择（由平台统一维护）"
              options={categoryList.map((item) => ({
                label: item.name,
                value: item.id,
              }))}
            />
          </Form.Item>
          <Flex gap={24} wrap>
            <Form.Item label="主图" name="main_image" style={{ flex: 1 }}>
              <Input readOnly placeholder="点右侧按钮从附件中心选图" />
            </Form.Item>
            <Button
              style={{ marginTop: 30 }}
              onClick={() => setPicker({ kind: 'main_image' })}
            >
              选择主图
            </Button>
          </Flex>
          <Flex gap={24} wrap>
            <Form.Item label="商品视频" name="video_url" style={{ flex: 1 }}>
              <Input readOnly placeholder="可选，从附件中心选视频" />
            </Form.Item>
            <Button
              style={{ marginTop: 30 }}
              onClick={() => setPicker({ kind: 'video' })}
            >
              选择视频
            </Button>
          </Flex>
        </Form>
      ) : (
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
      )}

      <AttachmentPicker
        open={Boolean(picker)}
        category={
          picker?.kind === 'video' ||
          (picker?.kind === 'spec' && picker.media === 'video')
            ? 'video'
            : 'image'
        }
        title={
          picker?.kind === 'video' ||
          (picker?.kind === 'spec' && picker.media === 'video')
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
