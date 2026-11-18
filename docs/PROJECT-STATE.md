# 项目实况（PROJECT-STATE）

> **这份文档是「现在到底是什么样」的唯一入口。**
> 与 `docs/admin-console.md`（功能口径与实现细节）配合看：
> 本篇给**地图与规则**，那篇给**每个功能的来龙去脉**。
> 最后更新：见 `git log -1 --format=%cd -- docs/PROJECT-STATE.md`。

---

## 1. 这是什么

多租户 C2C 商城 SaaS，一套代码三个前台 + 一个后台任务进程：

| 端 | 入口 | 代码 | 说明 |
| --- | --- | --- | --- |
| 买家商城（公开） | `/products`、`/products/:id`、站点首页 | `src/pages/products/`、`src/pages/site/` | 匿名可浏览，下单需登录 |
| 租户控制台 | `/dashboard`、`/commerce/*`、`/orders`、`/im` … | `src/pages/`（Ant Design Pro） | 租户运营用：商品审核、订单、财务、账号、站点品牌 |
| 买家中心 | `/portal/*` | `src/pages/portal/` | 左侧导航 + 右内容区 |
| 卖家中心 | `/portal/seller/*` | `src/pages/portal/seller/` | **独立页面**，另一套侧栏 |
| 平台控制台 | 8001 | `apps/platform/` | 平台总部：租户、套餐、类目、全站商品/收藏/评价、审计、定时任务 |
| 后端 API | 9000 `/api/v1` | `backend/`（FastAPI + SQLAlchemy async + Alembic） | |
| 延时任务 worker | 无常驻端口 | `backend/app/worker/jobs.py` | 自动收货、货款划转 |

**技术栈**：Umi Max v4 + antd v6 + ProComponents v3 + TanStack Query；FastAPI + PostgreSQL；Redis 仅用于 IM 广播与限流（有降级）；Tiptap v3 富文本；nh3 服务端清洗。

---

## 2. 本地怎么跑

```bash
python3 scripts/dev-up.py --restart   # 起 4 个进程并等就绪
python3 scripts/dev-up.py --check     # 只自检（含 worker 心跳探针）
```

| 进程 | 地址 | 日志 |
| --- | --- | --- |
| backend | http://127.0.0.1:9000 | `/tmp/backend.log` |
| jobs-worker | 无端口（心跳 `/api/v1/public/jobs/heartbeat`） | `/tmp/jobs-worker.log` |
| tenant-console | http://127.0.0.1:8010 | `/tmp/dev8010.log` |
| platform-console | http://127.0.0.1:8001 | `/tmp/dev8001.log` |

**演示账号**

| 账号 | 密码 | 角色 |
| --- | --- | --- |
| `admin` | `ant.design` | 租户管理员（运营） |
| `lisi` / `chenqi` / 其它种子用户 | `Antd@123456` | lisi 是运营+卖家；chenqi 是买家 |
| `e2e-shop@example.com` | `Buyer@123456` | e2e 专用买家 |
| `root`（平台） | `Sxxs@Platform2026` | 平台管理员 |

> 进程会**在回合之间被环境杀掉**，每次开工先 `--check`，不要假设 9000 还活着。

---

## 3. 架构地图（找东西用这张表）

```
backend/app/
  api/v1/          # 路由：commerce(租户) / portal_shopping(买家) / seller(卖家) /
                   #       public(匿名) / platform_*(平台) / wallet / im / audit …
  services/        # 业务：order / order_state / wallet / jobs / finance / catalog_specs /
                   #       catalog_stats / public_catalog / public_related / seller_center /
                   #       rich_text / attachment / review_moderation …
  models/          # 表：catalog / order / wallet / job / seller / tenant / user / im …
  worker/          # jobs.py（常驻执行器）+ handlers.py（任务注册表）
  data/regions.json# 内置省市区（34/345/3104）
  migrations/      # Alembic，head = d5c8e1a73f26（钱包三表）

src/
  components/      # 可复用组件（**必须从这里导出**，见第 9 节）
  services/        # 前端 API：commerce / im / system / wallet + ant-design-pro(生成，勿改)
  pages/           # 控制台页面（Ant Design Pro 布局）
  pages/portal/    # 买家中心 + 卖家中心
  pages/products/  # 公开商城（列表瀑布流 / 详情）
  pages/site/      # 公开站点首页与站点外壳
  utils/labels.ts  # 全站枚举文案中枢（状态/类型/交付方式）
```

**平台控制台页面**：`tenants`（列表/套餐/服务类目）、`users`、`billing`（SaaS 账单/抽佣）、`catalog`（商品/分类/收藏/评价）、`moderation`（附件审核）、`audit`、`jobs`（定时任务）、`notifications`、`services`、`settings`。

---

## 4. 业务域现状

| 域 | 现状 | 关键落点 |
| --- | --- | --- |
| 账号与权限 | 租户 RBAC（权限码）+ 平台独立鉴权（`aud` cookie 隔离）；卖家走**归属校验**不靠权限码 | `services/auth.py`、`services/platform_auth.py`、`access.ts` |
| 站点品牌 | logo/favicon/全站名称/站点描述/ICP；**买家中心顶栏只显 logo**（站名进 aria-label） | `services/tenant_brand.py`、`hooks/useSiteBrand.ts` |
| 商品 | 类型四步向导（类型→基础→规格→详情→**交付**）；多规格笛卡尔积 SKU；主图/视频；Tiptap 富文本 | `ProductEditor`、`catalog_specs.py`、`rich_text.py` |
| 商品类型 | 只有 `physical` 开放；创建后不可改；非实物后端 400 | `schemas/commerce.py`、`order_state` 无关 |
| 交付方式 | 快递 / 自提可多选（不预勾选）；落 `seller_orders.delivery_method` | `products.delivery_methods`、`shops.address/pickup_note` |
| 订单 | **双状态**：`payment_status` + `fulfillment_status`；旧 `status` 已删 | `services/order_state.py::sync_order()` |
| 订单列表 | 一行一商品、`rowSpan` 合并、横向滚动、**不做金额合计**；买家端**无详情页**（信息全进列） | `commerce/orders`、`portal/orders` |
| 结算与支付 | **独立订单确认页 `/portal/checkout`**（不是弹窗）：商品清单 + 地址 + 备注 + 三种支付方式在同一页，**点「提交订单并支付」才建单**；详情页「立即购买」直接进此页（不进购物车），购物车「去结算」也进此页；待支付订单点「去支付」→ 支付结果页 | `portal/checkout`、`services/checkout.py`、`portal/payment-result` |
| 售后 | 买家 `paid/shipped` 可申请 → `refunding`；**卖家处理前买家可自己撤回**；卖家/运营同意或驳回；`completed` 之后拒绝 | `order.request_refund/cancel_refund_request/reject_refund` |
| 收藏/评价 | 四端打通（买家→卖家→运营→平台）；**先发后审**；匿名只在买家侧打码 | `services/favorites.py`、`reviews.py` |
| 销量/浏览/收藏/评分 | 口径集中在 `catalog_stats`；浏览=详情页 PV；销量按 `SOLD_FULFILLMENTS` | `services/catalog_stats.py` |
| IM | 一套组件三处复用；文本/图/视频/商品卡/emoji/搜索/软删/撤回(2min)/编辑(15min) | `components/ImChat`、`services/im` |
| 钱包 | **统一钱包、按租户隔离**；余额支付；退款一律回余额；货款到期自动划转 | `services/wallet.py`、`models/wallet.py` |
| 支付渠道 | **真实接入**：支付宝**公钥证书模式**（电脑网站支付）+ 微信 Native 扫码；回调验签/解密、金额核对、幂等；**下单即排对账任务**（回调到不了也能补状态） | `services/payment/`、`api/v1/payments.py` |
| 提现 | 申请即冻结 → **租户运营**审核 → 打款/驳回 | `/commerce/finance/withdrawals` |
| 定时任务 | `scheduled_jobs` + 常驻 worker + 平台管理页 | `services/jobs.py`、`worker/` |

---

## 5. 数据模型要点

### 订单三兄弟

```
orders            payment_status / fulfillment_status / receiver_* / paid_at / cancelled_at / completed_at
seller_orders     同上两个状态 + delivery_method + shipped_at / completed_at
order_items       product_type / delivery_method / image / sku_name / commission_rate_bps（全是快照）
```

**订单级状态由卖家单汇总**，规则只写在一处：`order_state.sync_order()`
- 全退款 → `payment=refunded` 且 `fulfillment=cancelled`（显示「已关闭」）
- 有任一发/完成 → `shipped`（**没有「部分发货」**）
- 全部完成 → `completed`

### 钱包

```
wallet_accounts      (tenant_id, user_id) UNIQUE，balance_cents / frozen_cents
wallet_transactions  append-only + balance_after；UNIQUE(type,ref_type,ref_id) 与 idempotency_key
wallet_withdrawals   收款方式+账号+姓名、status、reviewed_by
```

### 任务

```
scheduled_jobs       kind / ref_type / ref_id / run_at / status / attempts / last_error
worker_heartbeats    instance_id / last_seen_at / jobs_done
```

---

## 6. 硬规则（违反即视为 bug）

1. **人物标识一律「用户ID + 用户名」**：`usr_xxx`（可复制）+ `username`；店铺名/卖家名只能做副行。
   查询时 join `users`，不存冗余名字。现成写法：`services/audit.actor_directory()`、`components/IdentityText`。
   **唯一例外**：买家侧展示卖家只给 `username`（不给 `usr_xxx`）。
2. **不要自作主张 `git push`**：默认只本地 commit；一次授权只覆盖当次。
3. **全局不要反复写零散组件**：有原生组件就用原生；自写组件必须打包成可复用组件（第 9 节）。
4. **dev 在跑时不要 `npm run build`**：两者都写 `src/.umi`，会把 dev 的 chunk 图弄脏（页面卡「正在加载资源」）。
   顺序：停 dev → build → 再起 dev。
5. **Biome only**（无 ESLint/Prettier）；提交前 `npx biome check src` + `npx tsc --noEmit` 都要过。
6. **不要手改 `src/services/ant-design-pro/`**（生成物）。
7. **`npm run simple` 不可逆**。

---

## 7. 关键不变量（已有测试锁死，改动前先看测试）

| 不变量 | 锁在哪里 |
| --- | --- |
| 钱只有一份：`Payout 可提现 + 钱包余额 == 货款总额`（划转写负数 ledger） | `test_wallet.py::test_earnings_transfer_and_no_double_withdrawal` |
| 钱包余额只能由流水驱动、余额不足必拒 | `test_wallet.py::test_wallet_pay_rejects_insufficient_balance` |
| 充值/支付/退款/划转全部幂等 | `test_wallet.py`（前四条） |
| 全额退款 → 订单「已关闭」 | `test_order_list_and_regions.py::test_refunded_order_is_closed` |
| 快递必须运单号、自提不需要 | `test_order_dual_status_delivery.py` |
| 卖家改规格要重新过审（运营端不回退） | `test_seller_product_wizard.py` |
| 非 `physical` 商品类型后端拒绝 | `test_product_type.py` |
| 商品编辑器多步切换不丢字段 | `e2e/product-editor.e2e.spec.ts` |
| 商品类型/交付方式未选不能发布 | `test_product_type.py`、`test_seller_product_wizard.py` |

---

## 8. 定时任务与进程管理

```
pm2 start ecosystem.config.js     # sxxs-api + sxxs-jobs
```

- 任务表是真相：`scheduled_jobs`；入队/撤销与业务**同事务**
- worker 每轮：回收僵尸（running > 5min）→ `FOR UPDATE SKIP LOCKED` 取一批 → 逐条执行
- 失败退避 1/5/30 分钟，超 3 次 `failed`；SIGTERM 跑完当前批再退
- 心跳 30s，平台 `/jobs` 页与 `/public/jobs/heartbeat` 据此判在线（**只有 pm2 起了 worker，自动收货才会真的执行**）

现有任务类型：
- `auto_complete`：发货后 7 天（快递）/ 90 天（自提）自动完成，复用买家确认收货同一段逻辑
- `settle_earnings`：账期到期，货款划入卖家钱包

---

## 9. 组件复用（硬规则 3 的落地细节）

**顺序**：先找原生组件（antd / ProComponents）→ 再找 `src/components/` 已有业务组件 → 都没有才自己写。

**自己写就必须打包**：
1. 放 `src/components/<Name>/index.tsx`
2. 从 `src/components/index.ts` 导出（当前已导出：`IdentityText`、`ListToolbar`、`MediaField`、
   `RegionCascader`、`ImChat`、`RichTextEditor/Viewer`、`AttachmentPicker`、`ProductFavoriteTable`、
   `ProductReviewTable`、`ReviewFormModal` …）
3. 页面里 `import { X } from '@/components'`，**不要按路径 import**

**已经收敛过的同类 UI（再复制一份就是回退）**：

| 用途 | 组件 |
| --- | --- |
| 人物标识（用户ID + 用户名） | `components/IdentityText` |
| 列表搜索/筛选栏 | `components/ListToolbar` |
| 图片/视频选择与预览 | `components/MediaField` + `AttachmentPicker` |
| 省市区选择 | `components/RegionCascader` |
| 富文本编辑/展示 | `components/RichTextEditor` / `RichTextViewer` |
| 页面外壳 | `pages/site`（商城）、`PortalLayout`（买家/卖家）、`SettingPage`（控制台） |

**只服务单页但可能复用的**：抽到该页 `components/` 下，并在 commit 说明里标注「可提升」。

**跨端同一件事必须同一套说法**：配置字段中文名（「运行环境」「App ID」等）以租户控制台
`src/pages/system/settings/*` 为准；平台端动态表单走 `apps/platform/src/pages/services/configLabels.ts`，
两边不能各叫一个名字。

---

## 10. 测试与验证矩阵

```bash
# 后端（529 条）
cd backend && uv run pytest -q

# 前端单测（node lane，82 条）
npx vitest run --config vitest.node.config.ts

# 类型 / 风格 / 构建
npx tsc --noEmit && (cd apps/platform && npx tsc --noEmit)
npx biome check src e2e
npm run build            # 先停 dev！

# e2e（需要 3 个服务在跑）
E2E_PORT=8010 npx playwright test --config playwright.e2e.config.ts e2e/portal.e2e.spec.ts
# permissions / seller / product-editor 同理
```

| 套件 | 数量 | 覆盖 |
| --- | --- | --- |
| `backend/tests` | 529 | 域逻辑 + 迁移 schema-drift + 权限隔离 |
| vitest node lane | 82 | 纯函数（masonry / specUtils / token 刷新 / access） |
| e2e portal | 10 | 商城浏览、购物车下单支付、收藏、评价、地址、IM |
| e2e permissions | 10 | RBAC 与越权 |
| e2e seller | 4 | 卖家中心 + 发布向导 |
| e2e product-editor | 1 | 多步表单不丢字段 |

> e2e 连续跑几套时会撞 `/auth/login` 限流（表现为 loginAs 45s 超时）——重跑单套即可，不是回归。

---

## 11. 已知坑（带判别口诀）

| 现象 | 病根 | 口诀 |
| --- | --- | --- |
| 自定义控件「选了值但保存后是空的」 | 控件不是 `Form.Item` 的**注册字段**（用隐藏字段 + setFieldsValue），`validateFields()` 拿不到 | 自定义控件必须挂在 `Form.Item name=...` 上；后端 schema 也别给默认空串，空值要 422 拒绝 |
| 结算页展示的价格与下单时不一致 | 前端自己拿商品详情拼清单 | 清单只来自服务端 `checkout/preview`，提交时后端再算一次（以后端为准） |
| 保存成功但值变空 | 多步表单用条件渲染把 `<Form>` 卸载了 | **多步表单 + 保存按钮只在最后一步 = 必须检查 Form 是否被卸载**；用 `display` 切换 |
| 页面卡「正在加载资源」 | dev 与 build 抢写 `src/.umi`，chunk 图不一致 | **build 前先停 dev**；恢复靠重启 dev（或 `rm -rf node_modules/.cache`） |
| 显示时间差 8 小时 / 显示成 ISO 原文 | 直接截字符串或用 `toLocaleString()`，各页格式还不一样 | **统一用 `utils/datetime.ts`**（`formatDateTime` / `formatDateTimeFull` / `formatDate`），别在页面里自己写 |
| `test_migrations` 报 schema drift | 手写迁移与模型不一致（`server_default`、命名约束、部分索引） | **迁移与模型逐列逐约束对齐**；`unique=True` 与具名 `UniqueConstraint` 名字必须一致 |
| 新接口 404 / 列表空 | uvicorn 没重启 | **后端加路由/改代码必须重启**（前端 HMR 不覆盖后端） |
| 新页面 404 | 路由改了但 dev server 没重启 | **改了 `config/routes.ts` 要重启 dev** |
| e2e 找不到按钮 | antd 给两字按钮插空格（`保 存`） | 用 `/保\s*存/` 或 `getByRole` + 正则 |
| Playwright 点不到多步表单里的元素 | 页面上同时挂了两个同组件实例（create+edit） | **testid 查询必须限定在弹窗内** |
| 库存/加购莫名失败 | 演示商品库存被 e2e 反复跑耗光 | 先补库存再重跑 |
| 富文本样式被清空 | nh3 默认丢 `style` | **`filter_style_properties` 必须显式传** |
| `response_model` 吞字段 | Pydantic 按模型裁字段 | 新字段要么进模型，要么用 `dict` |
| 迁移里的部分唯一索引 | autogenerate 看不见 | 幂等改应用层"先查后插" |
| 后端改了变量遮蔽 | `hold_days = await hold_days(...)` | 局部变量别与函数同名 |
| 用户说"付了款但订单还是待支付" | 回调到不了（本地/内网/域名未备案/开放平台没登记回调地址） | 下单即排 `payment_sync` 对账任务（1 分钟后首个查询，1/5/30 分钟退避）；买家支付页也有「刷新支付状态」按钮 |
| 支付宝查询报 `'utf-8' codec can't decode` | 网关出错时返回 **GBK** 错误页，不是 JSON | 查询响应做 utf-8/gbk 兜底解码，失败给「非 JSON 响应」中文提示 |
| 支付宝报 `invalid-signature` | ①证书模式缺 `app_cert_sn`/`alipay_root_cert_sn`；②私钥与控制台「应用公钥」不是一对；③**待签名字符串漏了 `sign_type`**（实测网关要含它，官方文档写的是剔除——以实测为准） | 诊断页给推导公钥 + 两个 SN；`sign()` 默认 `with_sign_type=True`，有测试锁死 |
| 微信回调一直验签失败（密钥正确） | 回调签名串与「我方请求」不同：回调只有 `timestamp\nnonce\nbody\n`，**不含 method 与 URL** | 两种串分开写（`build_notify_message` vs `build_message`） |
| 多租户只有一个回调地址 | 回调不带租户信息 | `payments.out_trade_no = T{tenant_id}-{order_no}`，回调据此反查租户配置再验签 |
| 买家"点一下就支付成功" | 模拟支付后门 | 模拟支付**仅运营 + 非生产**放行；微信/支付宝必须走 `POST /portal/orders/{id}/payments` |
| 后台出现英文标签/菜单 | ① 动态表单直接拿配置 key 当 label；② 平台侧边栏按路由 name 查词表，缺**裸 key** | **动态表单必须过词表**（`apps/platform/src/pages/services/configLabels.ts`）；**平台 locale 里裸 key 与 `menu.*` 两种都要写** |

---

## 12. 交付与推送状态

- **当前 HEAD**：`37c3b8a` 之后又有支付/地址修复，**origin/main 落后若干提交，未推送**（按规则：等明确指令）
- 迁移链 head：`a8e2f61c4d05`（payments 真实支付字段）
- 最近交付（倒序）：钱包+订单列表直出+区划级联 → 订单双状态/交付/定时任务 →
  卖家向导复用 → 商品类型四步 → 品牌块 → IM 撤回窗口 → 买家/卖家中心 IM →
  两套侧栏 → 瀑布流/评价 Tab/猜你喜欢 → 富文本 → 商品媒体 → 商品交互四端 → 站点品牌/页脚

---

## 13. 文档索引

| 文档 | 内容 |
| --- | --- |
| `docs/PROJECT-STATE.md` | **本篇**：地图、规则、不变量、坑 |
| `docs/admin-console.md` | 功能口径与实现细节（品牌、商品、订单、IM、钱包、定时任务…） |
| `CLAUDE.md` / `AGENTS.md`（symlink） | 工程规范与 Critical Rules |
| `docs/cheatsheet.zh-CN.md` | Ant Design Pro 模板自带速查（与业务无关） |
| `docs/roadmap/` | 历史规划（如 v6.1.0） |

---

## 14. 记忆库整理记录

**186 → 132 条**（删 54，均为被实现覆盖的计划稿、重复结论、已修复的缺陷记录）。

删除范围（保留每类最新一条）：

- `*_plan_*` / `*_constraints_plan` / `*_decisions_plan`（已被实现覆盖）
- `utoopack_stale_chunk_*` ×3 → 保留 `utoopack_dev_server_stale_chunk_loading_forever`
- `masonry_*` ×3 → 保留 `masonry_fixed_columns_keep_empty_slots_and_detail_tabs_related_rail`
- `push/commit` 策略 ×4 → 保留 `never_auto_commit_wait_user_then_commit_and_push`（规则本尊在 `CLAUDE.md`）
- `husky_*` ×3 → 保留 `husky_v9_hook_*`
- `verify_*` / `green_check_*` ×5 → 保留 `verify_environment_live_and_import_ok_is_not_proof`
  + `reprobe_ports_and_accounts_same_turn_before_claiming_them`
- 通知模板/scope ×4 → 保留 `notification_scope_three_tiers_*`
  + `sxxs_notification_templates_scope_brand_ownership_and_variable_guard`
- 设置继承 ×3 → 保留 `sxxs_setting_inheritance_four_level_priority_secret_masking`
- 阶段完成总结（b3/b5/session_handoff/早期模板总结）→ 已被本篇取代
- 已修复缺陷记录（品牌头未接线、多规格 gap、模拟通知链、假 Tab）→ 删

**保留什么**：跨轮次仍有效的**决策/不变量**、可复用的**判别口诀**、以及容易重犯的**工程坑**。
新会话先用 `memory_search` 或直接读本篇，不要重复摸索。
