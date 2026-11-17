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
