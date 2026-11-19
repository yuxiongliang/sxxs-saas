import { expect, test } from '@playwright/test';
import { CUSTOMER, loginAs, OPERATOR } from './helpers/auth';

/**
 * Seller centre regression (plan §18 #3): the shop owner sees their own shop,
 * while a C-end buyer cannot use the seller endpoints behind the page.
 */

test.describe('seller centre', () => {
  test('shop owner sees their shop and products', async ({ page }) => {
    await loginAs(page, OPERATOR);
    // 卖家中心已改成「侧栏 + 子页面」：概览看店铺，商品列表在 /products
    await page.goto('/portal/seller');

    // 侧栏导航（买家中心/卖家中心是两套独立侧栏）
    const sider = page.locator('.portal-sider');
    await expect(sider).toBeVisible({ timeout: 30_000 });
    await expect(sider.getByText('我的商品')).toBeVisible();
    await expect(sider.getByText('我的评价')).toBeVisible();

    // 概览页：店铺信息
    await expect(page.getByText(/店铺：/).first()).toBeVisible({
      timeout: 30_000,
    });

    // 商品子页：新增商品入口（从概览不能断言它，已经拆成独立页面）
    await sider.getByText('我的商品').click();
    await expect(page).toHaveURL(/\/portal\/seller\/products/, {
      timeout: 20_000,
    });
    await expect(
      page.getByRole('button', { name: /发布商品|新增商品/ }).first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('publishes a product through the same wizard as the console', async ({
    page,
  }) => {
    /**
     * 卖家中心的新建商品用的是**跟运营端编辑商品同一套四步向导**
     * （类型 → 基础信息 → 规格 → 详情）。这条用例锁的就是「两边不要分叉」：
     * 只要有人把卖家侧改回扁平表单，这里立刻挂。
     */
    await loginAs(page, OPERATOR);
    await page
      .goto('/portal/seller/products', { waitUntil: 'commit' })
      .catch(() => undefined);
    await page.waitForTimeout(4000);

    await page.getByTestId('seller-create-product').click();
    // 新建商品也是独立页面（不再弹窗）
    await expect(page).toHaveURL(/\/portal\/seller\/products\/create/, {
      timeout: 30_000,
    });
    const modal = page.getByTestId('product-wizard');
    await expect(modal).toBeVisible({ timeout: 30_000 });

    // 第 1 步：类型
    await expect(modal.locator('.ant-steps-item-title')).toHaveCount(5);
    await expect(modal.getByTestId('product-type-step')).toBeVisible();
    await modal.getByTestId('product-editor-next').click();
    await page.waitForTimeout(700);

    // 第 2 步：基础信息（卖家侧没有「佣金比例」）
    const name = `向导商品-${Date.now()}`;
    await modal.locator('input#name').fill(name);
    await expect(modal.getByText('卖家佣金比例（%）')).toHaveCount(0);
    await modal.getByTestId('product-editor-next').click();
    await page.waitForTimeout(700);

    // 第 3 步：规格（默认单 SKU 的价格/库存）
    await modal.getByTestId('spec-price-__default__').fill('12.5');
    await modal.getByTestId('spec-stock-__default__').fill('7');
    await modal.getByTestId('product-editor-next').click();
    await page.waitForTimeout(900);

    // 第 4 步：详情（富文本）
    await expect(modal.getByTestId('rich-text-toolbar')).toBeVisible({
      timeout: 20_000,
    });

    // 第 5 步：交付（卖家必须自己选，不选不能发布）
    await modal.getByTestId('product-editor-next').click();
    await page.waitForTimeout(800);
    await expect(modal.getByTestId('product-delivery-step')).toBeVisible();
    await modal.getByTestId('delivery-express').check();

    await page
      .locator('button:has-text("保 存"), button:has-text("保存")')
      .first()
      .click();
    // 保存后回列表
    await expect(page).toHaveURL(/\/portal\/seller\/products$/, {
      timeout: 30_000,
    });

    // 新商品出现在列表里
    await expect(page.getByText(name).first()).toBeVisible({
      timeout: 20_000,
    });

    // 软删除：卖家能删自己的商品，删完列表里不再有（行还在库里，历史订单照旧）
    const row = page.locator('tr', { hasText: name }).first();
    await row.getByRole('button', { name: /删\s*除/ }).click();
    await page
      .locator('.ant-popconfirm-buttons .ant-btn-primary')
      .first()
      .click();
    await expect(page.getByText(name).first()).toBeHidden({ timeout: 20_000 });
  });

  test('shop management hosts the pickup store settings', async ({ page }) => {
    /**
     * 「自提点设置」原来躺在店铺概览里，现在收进「店铺管理」子页，并改名「自提门店」。
     * 概览只留一行入口 —— 概览是看数的地方，不放表单。
     */
    await loginAs(page, OPERATOR);
    await page
      .goto('/portal/seller', { waitUntil: 'commit' })
      .catch(() => undefined);
    await page.waitForTimeout(3500);

    // 侧栏有「店铺管理」，概览里没有自提设置卡
    const sider = page.locator('.portal-sider');
    await expect(sider.getByText('店铺管理')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('seller-pickup-card')).toHaveCount(0);

    await sider.getByText('店铺管理').click();
    await expect(page).toHaveURL(/\/portal\/seller\/shop/, { timeout: 20_000 });
    await expect(page.getByTestId('seller-shop-page')).toBeVisible({
      timeout: 30_000,
    });
    // 新叫法必须出现，旧叫法必须消失
    await expect(page.getByText('自提门店').first()).toBeVisible();
    await expect(page.getByText('自提点').first()).toHaveCount(0);

    // 保存链路（后端 PUT /portal/seller/shop）
    await page.getByTestId('seller-shop-save').click();
    await expect(page.getByText(/已保存/).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('product list shows a dedicated image column', async ({ page }) => {
    await loginAs(page, OPERATOR);
    await page
      .goto('/portal/seller/products', {
        waitUntil: 'commit',
      })
      .catch(() => undefined);
    await page.waitForTimeout(3500);
    const headers = await page.locator('thead th').allInnerTexts();
    expect(headers.map((item) => item.replace(/\s+/g, ''))).toContain(
      '商品图片',
    );
  });

  test('buyer opening the seller centre gets no shop data', async ({
    page,
  }) => {
    await loginAs(page, CUSTOMER);

    const failures: string[] = [];
    page.on('response', (response) => {
      if (
        response.url().includes('/api/v1/portal/seller/') &&
        response.status() === 403
      ) {
        failures.push(response.url());
      }
    });

    await page.goto('/seller', { waitUntil: 'commit' }).catch(() => undefined);
    await page.waitForTimeout(4000);

    // The backend must refuse the seller APIs for a C-end customer.
    expect(failures.length).toBeGreaterThan(0);
  });

  test('admin can open the seller management page', async ({ page }) => {
    await loginAs(page, { username: 'admin', password: 'ant.design' });
    await page.goto('/sellers');
    await expect(page.getByText('403', { exact: true })).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(page.getByText(/卖家/).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
