# CLAUDE.md

## Project

多租户 C2C 商城 SaaS（不是纯模板了）：买家商城 + 租户控制台 + 买家/卖家中心 + 平台控制台 +
FastAPI 后端 + 延时任务 worker。

> **开工前先读 `docs/PROJECT-STATE.md`** —— 那里有目录地图、硬规则、关键不变量、已知坑与推送状态。
> 功能口径看 `docs/admin-console.md`。

原模板部分：Ant Design Pro — React enterprise boilerplate on Umi Max v4, antd v6, ProComponents v3.

## Commands

`npm start` (dev+mock), `npm run dev` (no mock), `npm run build` (utoopack), `npm run lint` (Biome+tsc), `npm run test` (Jest), `npx antd lint ./src` (antd-specific checks).

Other: `npm run openapi` (regenerate `src/services/`), `npm run simple` (**irreversible** — commit first), `npm run biome` (auto-fix), `npm run tsc` (type-check only).

## Critical Rules

- **Never edit `src/services/ant-design-pro/`** — auto-generated, regenerate with `npm run openapi`
- **dev server 在跑时不要 `npm run build`** —— 两者都写 `src/.umi`，会让 dev 的 chunk 图与磁盘不一致：
  页面卡在「正在加载资源」、控制台报 `Unexpected token '<'`。顺序：先停 dev → build → 再起 dev。
  重启与自检用 `python3 scripts/dev-up.py --restart`（会等就绪并验三个入口）。
- **Biome only** — no ESLint, no Prettier. Both `npm run lint` and `npx antd lint ./src` must pass before commit
- **Always `npx antd info <Component>` before writing antd code** — don't guess APIs from memory
- **`npm run simple` is irreversible** — always commit/branch first
- **Conventional commits** required (commitlint enforced)
- **TypeScript strict** · **Node ≥ 22** · **`package-lock.json`** (not yarn/pnpm)
- **`.umi` dir is auto-generated** — delete `src/.umi` and restart if dev server acts up
- **人的标识一律给「用户ID + 用户名」** — 界面上不要出现裸自增 ID（`users.id`、`seller_id`、`buyer_id`、
  `actor_id`），一律展示 `public_id`（`usr_xxx`，可复制）+ `username`；店铺名/卖家名只能做副行。
  数据库不存冗余名字，查询时 join `users`（现成写法：`services/audit.actor_directory()`）。
  新增接口字段命名：`owner_public_id`/`owner_username`、`buyer_public_id`/`buyer_username`、
  `actor_public_id`/`actor_username`。详见 `docs/admin-console.md` →「人物标识口径」。
- **不要自作主张 `git push`** — 默认只本地 `git commit`。只有用户**明确说「推送到 GitHub」**的那一次才 push，
  之后的每次改动都不要顺带推。上一次授权不构成长期授权。
- **全局全站点不要反复写零散的组件**：有原生组件（antd / ProComponents / 已有业务组件）的就**复用原生组件**；
  如果没有组件、一定要自己写的情况下，**写好的组件也要打包成组件，保证后续可复用**。
  落地要求（不照做就不算完成）：
  1. 写新组件前先查 `src/components/` 与 `src/components/index.ts` —— 已经有同类就别再造一个；
  2. 自写组件放 `src/components/<Name>/index.tsx`，并从 `src/components/index.ts` **导出**，
     让页面 `import { X } from '@/components'`，而不是各处按路径 import；
  3. 只服务单页但有可能被第二次使用的，抽到该页 `components/` 下，并在 PR/commit 说明里标注「可提升」；
  4. 同一类 UI 出现第三处就必须收敛（例：`IdentityText` 人物标识、`ListToolbar` 列表搜索栏、
     `MediaField` 媒体选择、`RegionCascader` 省市区、`PageShell` 页面外壳、`SettingPage` 设置页外壳）。
  详见 `docs/PROJECT-STATE.md` →「组件复用」。

## Architecture Essentials

**Config**: `config/config.ts` (defineConfig), `config/routes.ts` (declarative routes). Route `name` → `menu.xxx` i18n key; `access` field gates visibility.

**Convention files** (`src/`): `app.tsx` (runtime config + `getInitialState`), `access.ts` (permissions), `global.tsx` (side effects), `loading.tsx`, `typings.d.ts`.

**Auth**: `getInitialState()` → `GET /api/currentUser`; 401 → redirect login. `access.ts`: `canAdmin = currentUser.access === 'admin'`. Mock creds: `admin`/`ant.design` or `user`/`ant.design`.

**State**: `useModel('filename')` for global hooks (`src/models/`). `useModel('@@initialState')` for currentUser/settings. ProTable `request` prop for most data loading. `@tanstack/react-query` for complex server state.

**Styling priority**: Tailwind CSS v4 (layout) → antd-style v4 / `createStyles` (theme tokens) → CSS Modules → Less (legacy only).

**Request**: built-in `request` from `@umijs/max`, configured in `src/requestErrorConfig.ts`. Per-page `service.ts` for non-generated APIs.

**i18n**: 8 locales in `src/locales/`. `useIntl().formatMessage({ id, defaultMessage })`.

**Mock**: `mock/` (global) + `src/pages/**/_mock.ts` (co-located). Express-style handlers.

**Cloudflare Worker**: `cloudflare-worker/` — separate Hono app, own `package.json`, not an npm workspace.

## AI Skills

This project ships with two built-in Claude Code Skills (`.claude/skills/`). If you already have these skills in your project, no installation is needed — just run them directly. To update to the latest skill definitions, run `npx skills add ant-design/ant-design-pro`.

### `/pro-upgrade` — Project Upgrade

Run `/pro-upgrade` in Claude Code to auto-upgrade the project to the latest Ant Design Pro version. It diffs the latest template against this project and merges framework changes while preserving business code. Works for any version gap (v5→v6, v6.x→latest, etc.).

### `/antd` — Ant Design CLI

Run `/antd` in Claude Code for any antd-related work. It provides access to `@ant-design/cli` with offline metadata for antd v3/v4/v5/v6. Key commands:

- `npx antd info <Component>` — look up props/API before writing code (mandatory)
- `npx antd lint ./src` — check for deprecated or problematic usage (must pass before commit)
- `npx antd demo <Component> <demo>` — get working code examples
- `npx antd migrate <from> <to>` — migration checklist between major versions

## Page Co-location

Each page dir: `index.tsx`, optional `service.ts`, `_mock.ts`, `data.d.ts`, style files. Keep page-specific code with the page.

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---