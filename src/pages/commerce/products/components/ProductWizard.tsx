import {
  ArrowLeftOutlined,
  LeftOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  RightOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import {
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Flex,
  Form,
  Input,
  InputNumber,
  Radio,
  Row,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import AttachmentPicker from '@/components/AttachmentPicker';
import LocationPicker, {
  type LocationValue,
} from '@/components/LocationPicker';
import MediaField from '@/components/MediaField';
import type { RichTextValue } from '@/components/RichTextEditor';
import RichTextEditor from '@/components/RichTextEditor';
import type { ProductSpecsPayload } from '@/services/commerce/api';
import {
  getAdminProduct,
  listAdminCategories,
  unlockAdminProductCommission,
  updateAdminProduct,
  updateAdminProductSpecs,
} from '@/services/commerce/api';
import type { CategoryRecord, ProductRecord } from '@/services/commerce/types';
import {
  DELIVERY_METHOD_OPTIONS,
  OPEN_PRODUCT_TYPES,
  PRODUCT_TYPE,
} from '@/utils/labels';
import {
  buildCombos,
  type Combo,
  comboKey,
  DEFAULT_KEY as DEFAULT_COMBO_KEY,
  resolveMedia,
} from './specUtils';

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
  | { kind: 'spec'; groupKey: string; valueKey: string };

/**
 * 商品类型 → 后续步骤。
 *
 * **数据驱动**而不是硬编码 3 步：以后开放虚拟/知识付费/活动报名时，
 * 只是在这里加一行（那些类型的步骤显然不会跟实物一样：没有规格库存、
 * 要填课程/场次信息），不用重写组件。
 */
const TYPE_FLOWS: Record<
  string,
  Array<'basic' | 'specs' | 'detail' | 'delivery'>
> = {
  physical: ['basic', 'specs', 'detail', 'delivery'],
};

const STEP_LABELS: Record<string, string> = {
  type: '类型',
  basic: '基础信息',
  specs: '规格',
  detail: '详情',
  delivery: '交付',
};

/** 运营端适配器：控制台商品管理用的那一套接口 */
const adminAdapter: ProductWizardAdapter = {
  load: getAdminProduct,
  categories: () => listAdminCategories(),
  saveBasic: async (id, payload) => {
    if (!id) throw new Error('运营端不支持在此新建商品');
    await updateAdminProduct(id, payload);
    return id;
  },
  saveSpecs: async (id, payload) => {
    await updateAdminProductSpecs(id, payload);
  },
  unlockCommission: async (id) => {
    await unlockAdminProductCommission(id);
  },
  showCommission: true,
};

/**
 * 「谁能保存什么」的适配层。
 *
 * 运营端和卖家中心**共用同一套向导**（类型 → 基础信息 → 规格 → 详情），
 * 差异只有三处：读哪个详情接口、存哪个接口、有没有佣金/解锁这种运营专属能力。
 * 硬编码成运营接口的话，卖家中心只能复制 800 行再各自演化 —— 那才是真正的坑。
 */
export interface ProductWizardAdapter {
  /** 编辑：加载详情（含 spec_groups / skus）。新建不需要 */
  load?: (id: number) => Promise<ProductRecord>;
  /** 分类下拉（平台级分类，两边同一份数据） */
  categories: () => Promise<CategoryRecord[]>;
  /**
   * 保存基础资料：编辑传 id，新建返回新商品 id。
   * 新建时返回的 id 会立刻用于保存规格。
   */
  saveBasic: (
    id: number | undefined,
    payload: Record<string, unknown>,
  ) => Promise<number | undefined>;
  /** 保存规格树 */
  saveSpecs: (id: number, payload: ProductSpecsPayload) => Promise<void>;
  /** 运营端专属：解除佣金锁定 */
  unlockCommission?: (id: number) => Promise<void>;
  /** 是否显示佣金比例（卖家侧没有这个概念） */
  showCommission?: boolean;
}

interface ProductWizardProps {
  productId?: number;
  /** create = 新建商品（卖家中心用），edit = 编辑（默认） */
  mode?: 'create' | 'edit';
  /** 不传则用运营端适配器 */
  adapter?: ProductWizardAdapter;
  /** 返回列表（未保存时会先确认） */
  onCancel: () => void;
  onSaved: (id?: number) => void;
}

/**
 * 商品编辑：两步（基础信息 / 规格）。
 *
 * 规格用「规格组 → 规格值」两级输入，保存时由后端做笛卡尔积生成 SKU；
 * 每个规格值可挂 1 图或 1 视频，SKU 还能再挂一层覆盖图（优先级最高）。
 * 展示区：**滑动切组合**（左右箭头/触摸滑动），点缩略图切当前组合的图。
 */
export default function ProductWizard({
  productId,
  mode = 'edit',
  adapter,
  onCancel,
  onSaved,
}: ProductWizardProps) {
  // 不传适配器 = 运营端（保持原来的调用方式不变）
  const activeAdapter = adapter ?? adminAdapter;
  const showCommission = activeAdapter.showCommission ?? false;
  const isCreate = mode === 'create';
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [step, setStep] = useState(0);
  // 商品类型：创建时确定，编辑时只读（改类型会让已有订单/库存/发货语义断层）
  const [productType, setProductType] = useState<string>('physical');
  // 交付方式（实物）：物流快递 / 自提，可多选；**不预勾选**，不选不能发布
  const [deliveryMethods, setDeliveryMethods] = useState<string[]>([]);
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
  // 未保存拦截：初始化（回填）阶段不置脏，回填完成后任何编辑都算脏
  const hydrated = useRef(isCreate);
  const [dirty, setDirty] = useState(false);
  const { modal } = App.useApp();

  const handleBack = () => {
    if (!dirty) {
      onCancel();
      return;
    }
    modal.confirm({
      title: '放弃未保存的修改？',
      content: '返回列表后，这次填写的商品信息不会保留。',
      okText: '放弃并返回',
      cancelText: '继续编辑',
      okButtonProps: { danger: true },
      onOk: onCancel,
    });
  };

  // 刷新/关标签页也拦一下（浏览器原生确认，无法自定义文案）
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    setStep(0);
    setProductType('physical');
    setDeliveryMethods([]);
    setPreviewOverride(undefined);
    // 新建没有商品可加载：必须直接把富文本标成「已就绪」，
    // 否则第 4 步永远停在「加载中…」，卖家根本没地方写详情。
    setRichLoaded(isCreate);
    if (isCreate) {
      setRichText(null);
      setDetail(undefined);
      setGroups([]);
      setSkuDraft({});
      form.resetFields();
    }
    activeAdapter
      .categories()
      .then(setCategoryList)
      .catch(() => setCategoryList([]));
  }, []);

  useEffect(() => {
    if (!productId) return;
    if (!activeAdapter.load) return;
    activeAdapter
      .load(productId)
      .then((data) => {
        setDetail(data);
        // 编辑已有商品：类型只读展示（后端也不接受修改）
        setProductType(data.product_type || 'physical');
        setDeliveryMethods(data.delivery_methods ?? []);
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
          // 位置回显：省市区/地址/坐标一起给（任何一个缺都不影响其它）
          location: {
            province: data.province ?? undefined,
            city: data.city ?? undefined,
            district: data.district ?? undefined,
            address: data.address ?? undefined,
            latitude: data.latitude ?? null,
            longitude: data.longitude ?? null,
          },
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
        hydrated.current = true;
      })
      .catch((error: Error) => message.error(error.message));
    // activeAdapter 是模块常量或父级稳定引用，不放进依赖避免每次渲染重拉
  }, [productId, form, message]);

  useEffect(() => {
    if (!hydrated.current) return;
    setDirty(true);
  }, [groups, skuDraft, deliveryMethods, richText, productType]);

  const combos = useMemo(() => buildCombos(groups), [groups]);
  /** 是否真的有多规格（有组名 + 至少一个值）。只有多规格才有"按组合换图"的意义。 */
  const hasSpecs = useMemo(
    () =>
      groups.some(
        (group) =>
          group.name.trim() && group.values.some((value) => value.value.trim()),
      ),
    [groups],
  );
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

  /**
   * 规格值的媒体**一个入口**：附件选的是图就存 image_url、是视频就存 video_url。
   * 以前是「图」「视频」两个按钮，运营要先想"我该点哪个"，选错还得再点一次；
   * 现在由附件本身的类型决定，且两个字段互斥（展示时图优先于视频）。
   */
  const applyPicked = (url: string, isVideo: boolean) => {
    if (!picker) return;
    const target = picker;
    setPicker(undefined);
    if (target.kind === 'sku_image') {
      if (isVideo) {
        // 覆盖图只放图片：视频静默丢掉会让运营以为设上了
        message.warning('覆盖图只能选图片');
        return;
      }
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
                  : isVideo
                    ? { ...value, video_url: url, image_url: null }
                    : { ...value, image_url: url, video_url: null },
              ),
            },
      ),
    );
  };

  /** 清空某个规格值的媒体（回到"继承主图"），与下面的覆盖图清除同一套语义。 */
  const clearSpecMedia = (groupKey: string, valueKey: string) => {
    setGroups((prev) =>
      prev.map((group) =>
        group.key !== groupKey
          ? group
          : {
              ...group,
              values: group.values.map((value) =>
                value.key !== valueKey
                  ? value
                  : { ...value, image_url: null, video_url: null },
              ),
            },
      ),
    );
  };

  /** 清空某个组合的覆盖图（回到"按规格值图/主图展示"）。 */
  const clearSkuImage = (key: string) => {
    setSkuDraft((prev) => ({
      ...prev,
      [key]: {
        price_yuan: prev[key]?.price_yuan ?? 0,
        stock: prev[key]?.stock ?? 0,
        image_url: null,
        video_url: null,
      },
    }));
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
      if (!activeAdapter.unlockCommission || !activeAdapter.load) return;
      await activeAdapter.unlockCommission(productId);
      message.success('已解除锁定，卖家可自行修改佣金比例');
      setDetail(await activeAdapter.load(productId));
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);

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
      const specsPayload: ProductSpecsPayload = {
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
      };

      // 新建时后端要求一个"起售价/库存"（先建一条默认 SKU，随后由规格保存覆盖），
      // 取第一个填了价格的组合；一个都没填说明用户还没走到规格步。
      const defaultDraft =
        skuDraft[DEFAULT_COMBO_KEY] ??
        Object.values(skuDraft).find((draft) => Number(draft?.price_yuan) > 0);
      if (isCreate && !(Number(defaultDraft?.price_yuan) > 0)) {
        message.warning('请先在「规格」步骤填写价格');
        setStep(steps.indexOf('specs'));
        return;
      }

      if (deliveryMethods.length === 0) {
        message.warning('请先在「交付」步骤选择至少一种交付方式');
        setStep(steps.indexOf('delivery'));
        return;
      }

      const location = (values.location ?? {}) as LocationValue;
      const payload: Record<string, unknown> = {
        delivery_methods: deliveryMethods,
        name: values.name,
        // 位置：省市区 + 地址 + 坐标（空值传 null，后端归一成 NULL；
        // 坐标用 ?? null 而不是 '' —— 数字字段传空串会 422）
        province: location.province ?? null,
        city: location.city ?? null,
        district: location.district ?? null,
        address: location.address ?? null,
        latitude: location.latitude ?? null,
        longitude: location.longitude ?? null,
        description: values.description,
        category_id: values.category_id ?? null,
        main_image: values.main_image ?? '',
        // 视频以前根本没传，选了也白选 —— 现在一并保存
        video_url: values.video_url ?? '',
        // 富文本：doc 是真身，html 交给服务端用 nh3 重新清洗后落库
        ...(richText
          ? { description_doc: richText.doc, description_html: richText.html }
          : {}),
        ...(showCommission && typeof values.commission_percent === 'number'
          ? { commission_bps: Math.round(values.commission_percent * 100) }
          : {}),
        ...(isCreate
          ? {
              product_type: productType,
              price_cents: Math.round(Number(defaultDraft?.price_yuan) * 100),
              stock: Number(defaultDraft?.stock ?? 0),
            }
          : {}),
      };

      // 先落基础资料（新建时拿到 id），再整体保存规格树
      const savedId = await activeAdapter.saveBasic(productId, payload);
      const targetId = savedId ?? productId;
      if (!targetId) throw new Error('商品保存失败：未拿到商品 ID');
      await activeAdapter.saveSpecs(targetId, specsPayload);

      message.success(isCreate ? '商品已提交审核' : '商品已保存');
      // 保存成功就不再拦离开
      setDirty(false);
      hydrated.current = false;
      onSaved(targetId);
    } catch (error) {
      if ((error as { errorFields?: unknown }).errorFields) {
        // 必填项都在「基础信息」：跳回去，但别跳回类型步
        setStep(steps.indexOf('basic'));
        return;
      }
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // 类型是第 0 步，后面几步由类型决定（见 TYPE_FLOWS）
  const flowSteps = TYPE_FLOWS[productType] ?? TYPE_FLOWS.physical;
  const steps: string[] = ['type', ...flowSteps];
  const currentKey = steps[step] ?? 'type';
  const isLastStep = step >= steps.length - 1;
  // 第 0 步必须"看过并选了类型"才能往下走；目前只有实物可选中
  const canLeaveTypeStep = Boolean(productType);

  const nextButton = isLastStep ? (
    <Button
      type="primary"
      loading={saving}
      onClick={handleSave}
      data-testid="product-editor-save"
    >
      保存
    </Button>
  ) : (
    <Button
      type="primary"
      onClick={() => setStep(step + 1)}
      disabled={step === 0 && !canLeaveTypeStep}
      data-testid="product-editor-next"
    >
      {step === 0
        ? '下一步：基础信息'
        : `下一步：${STEP_LABELS[flowSteps[step] ?? 'detail']}`}
    </Button>
  );
  const prevButton =
    step > 0 ? <Button onClick={() => setStep(step - 1)}>上一步</Button> : null;

  return (
    <div data-testid="product-wizard">
      <Flex
        justify="space-between"
        align="center"
        wrap
        gap={12}
        style={{ marginBottom: 16 }}
      >
        <Space size={12}>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={handleBack}
            data-testid="product-editor-back"
          >
            返回列表
          </Button>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {isCreate ? '新建商品' : '编辑商品'}
            {detail?.name ? (
              <Typography.Text type="secondary" style={{ fontSize: 14 }}>
                {' '}
                · {detail.name}
              </Typography.Text>
            ) : null}
          </Typography.Title>
        </Space>
        <Space>
          {prevButton}
          {nextButton}
        </Space>
      </Flex>

      <Steps
        size="small"
        current={step}
        style={{ marginBottom: 20 }}
        items={steps.map((key) => ({ title: STEP_LABELS[key] }))}
      />

      {/*
        两步内容是「显示/隐藏」而不是「挂载/卸载」。

        以前这里是 `step === 0 ? <Form>...</Form> : <规格区/>`：切到第 2 步时
        `<Form>` 整个被卸载，antd 的字段 store 跟着没了，而「保存」按钮**只在第 2 步出现**
        —— 于是点保存时 `validateFields()` 拿不到主图/视频/名称/分类等基础字段，
        提交上去的 `main_image` 是空串，把库里的图**反而清掉了**。

        现在 Form 始终挂载，只切换可见性，字段值不会丢。
      */}
      {/* 第 1 步：类型。
          只有「实物商品」可选，其余三类显示「待开发」且禁用 —— 它们在下单/库存/
          发货/退款上还没打通，让用户选了只会产生一堆跑不通的数据。 */}
      <div
        style={{ display: currentKey === 'type' ? 'block' : 'none' }}
        data-testid="product-type-step"
      >
        <Radio.Group
          value={productType}
          onChange={(event) => setProductType(event.target.value)}
          style={{ width: '100%' }}
        >
          <Row gutter={[12, 12]}>
            {Object.entries(PRODUCT_TYPE).map(([value, label]) => {
              const open = OPEN_PRODUCT_TYPES.includes(value);
              return (
                <Col xs={24} sm={12} key={value}>
                  <Card
                    size="small"
                    style={{
                      opacity: open ? 1 : 0.55,
                      borderColor:
                        productType === value
                          ? 'var(--ant-color-primary)'
                          : undefined,
                    }}
                  >
                    <Radio value={value} disabled={!open}>
                      <Space>
                        <span style={{ fontWeight: 600 }}>{label}</span>
                        {open ? null : <Tag>待开发</Tag>}
                      </Space>
                    </Radio>
                  </Card>
                </Col>
              );
            })}
          </Row>
        </Radio.Group>
        <Typography.Paragraph
          type="secondary"
          style={{ marginTop: 16, marginBottom: 0 }}
        >
          类型在创建时确定，**创建后不可修改** ——
          已有订单、库存与发货流程都按创建时的
          语义进行，事后改类型会让历史订单对不上账。
        </Typography.Paragraph>
      </div>

      <Form form={form} layout="vertical">
        <div style={{ display: currentKey === 'basic' ? 'block' : 'none' }}>
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
          {/* 佣金是运营端概念：卖家中心不显示（后端也会忽略这个字段） */}
          {showCommission ? (
            <Form.Item
              label="卖家佣金比例（%）"
              name="commission_percent"
              extra={
                detail?.commission_locked
                  ? '该比例已被运营调整并锁定，保存后卖家不自行修改；需要放开请点下方「解除锁定」'
                  : '默认继承分类比例；填了就以这里为准（下限 1%）。卖家自己也能改'
              }
            >
              <InputNumber
                min={1}
                max={100}
                step={0.5}
                style={{ width: 220 }}
              />
            </Form.Item>
          ) : null}
          {showCommission && detail?.commission_locked ? (
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
          {/* 商品所在地：同城筛选 + 买家「距您 x km」都靠它。
              必须注册成 Form.Item（不注册就会出现"选了地址保存后是空的"那个老坑） */}
          <Form.Item
            label="商品所在地"
            name="location"
            extra="用于买家按「同城」筛选与计算距离；买家只能看到省市区，详细地址不公开"
          >
            <LocationPicker />
          </Form.Item>
        </div>
      </Form>

      <div style={{ display: currentKey === 'specs' ? 'block' : 'none' }}>
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
                        {value.image_url ? (
                          <img
                            src={value.image_url}
                            alt={value.value || '规格值图'}
                            style={{
                              width: 22,
                              height: 22,
                              objectFit: 'cover',
                              borderRadius: 4,
                              verticalAlign: 'middle',
                            }}
                          />
                        ) : null}
                        {value.video_url ? (
                          <VideoCameraOutlined
                            title="已挂视频"
                            style={{ color: '#1677ff' }}
                          />
                        ) : null}
                        <Button
                          size="small"
                          type="link"
                          onClick={() =>
                            setPicker({
                              kind: 'spec',
                              groupKey: group.key,
                              valueKey: value.key,
                            })
                          }
                        >
                          {value.image_url || value.video_url
                            ? '更换'
                            : '图/视频'}
                        </Button>
                        {value.image_url || value.video_url ? (
                          <Button
                            size="small"
                            type="link"
                            danger
                            onClick={() => clearSpecMedia(group.key, value.key)}
                          >
                            清除
                          </Button>
                        ) : null}
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
                        data-testid={`spec-price-${key}`}
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
                        data-testid={`spec-stock-${key}`}
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
                // 单规格商品没有"按组合换图"的语义，这一列只会和主图打架，直接不渲染
                ...(hasSpecs
                  ? [
                      {
                        title: (
                          <Tooltip title="只对这个组合生效，优先级：覆盖图 > 规格值图 > 主图。只有「同一规格值也要不同图」时才需要设置。">
                            <Space size={4}>
                              覆盖图
                              <QuestionCircleOutlined />
                            </Space>
                          </Tooltip>
                        ),
                        width: 150,
                        render: (_: unknown, combo: Combo) => {
                          const key = comboKey(combo);
                          const image = skuDraft[key]?.image_url;
                          return (
                            <Space size={2}>
                              {image ? (
                                <img
                                  src={image}
                                  alt="覆盖图"
                                  style={{
                                    width: 24,
                                    height: 24,
                                    objectFit: 'cover',
                                    borderRadius: 4,
                                  }}
                                />
                              ) : null}
                              <Button
                                size="small"
                                type={image ? 'link' : 'dashed'}
                                onClick={() => {
                                  setActiveKey(key);
                                  setPicker({
                                    kind: 'sku_image',
                                    comboKey: key,
                                  });
                                }}
                              >
                                {image ? '更换' : '设置'}
                              </Button>
                              {image ? (
                                <Button
                                  size="small"
                                  type="link"
                                  danger
                                  onClick={() => clearSkuImage(key)}
                                >
                                  清除
                                </Button>
                              ) : null}
                            </Space>
                          );
                        },
                      },
                    ]
                  : []),
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
      <div style={{ display: currentKey === 'detail' ? 'block' : 'none' }}>
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

      {/* 第 5 步：交付。
          只有实物商品有：物流快递 / 自提，可多选。
          不预勾选、不选不能发布（产品口径）—— 默认值会让人"不知不觉"发出去。 */}
      <div
        style={{ display: currentKey === 'delivery' ? 'block' : 'none' }}
        data-testid="product-delivery-step"
      >
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          {DELIVERY_METHOD_OPTIONS.map((option) => {
            const checked = deliveryMethods.includes(option.value);
            return (
              <Card
                key={option.value}
                size="small"
                style={{
                  borderColor: checked ? 'var(--ant-color-primary)' : undefined,
                }}
              >
                <Checkbox
                  checked={checked}
                  data-testid={`delivery-${option.value}`}
                  onChange={(event) =>
                    setDeliveryMethods((prev) =>
                      event.target.checked
                        ? [...prev, option.value]
                        : prev.filter((item) => item !== option.value),
                    )
                  }
                >
                  <span style={{ fontWeight: 600 }}>{option.label}</span>
                </Checkbox>
                <Typography.Paragraph
                  type="secondary"
                  style={{ margin: '6px 0 0 24px', fontSize: 12 }}
                >
                  {option.desc}
                </Typography.Paragraph>
              </Card>
            );
          })}
          {deliveryMethods.length === 0 ? (
            <Typography.Text type="danger">
              至少选择一种交付方式，否则不能发布
            </Typography.Text>
          ) : null}
        </Space>
      </div>

      {/* 页脚按钮与页头同源，长表单滚到底也能直接下一步/保存。
          注意：页脚的按钮**不带 testid** —— 同一个 testid 出现两次会让 e2e 的
          getByTestId 报 strict mode violation（页头和页脚各一个）。 */}
      <Flex justify="flex-end" gap={8} style={{ marginTop: 24 }}>
        {step > 0 ? (
          <Button onClick={() => setStep(step - 1)}>上一步</Button>
        ) : null}
        {isLastStep ? (
          <Button type="primary" loading={saving} onClick={handleSave}>
            保存
          </Button>
        ) : (
          <Button
            type="primary"
            onClick={() => setStep(step + 1)}
            disabled={step === 0 && !canLeaveTypeStep}
          >
            {step === 0
              ? '下一步：基础信息'
              : `下一步：${STEP_LABELS[flowSteps[step] ?? 'detail']}`}
          </Button>
        )}
      </Flex>

      <AttachmentPicker
        open={Boolean(picker)}
        // 规格值：图或视频都收（拉全部附件）；覆盖图：只收图片
        category={picker?.kind === 'spec' ? '' : 'image'}
        accept={picker?.kind === 'spec' ? 'image/*,video/*' : 'image/*'}
        uploadText={picker?.kind === 'spec' ? '上传图片或视频' : '上传图片'}
        title={picker?.kind === 'spec' ? '选择规格值图片或视频' : '选择覆盖图'}
        onCancel={() => setPicker(undefined)}
        onSelect={(record) =>
          applyPicked(
            `/api/v1/attachments/public/${record.id}`,
            record.category === 'video' ||
              Boolean(record.mime_type?.startsWith('video')),
          )
        }
      />
    </div>
  );
}
