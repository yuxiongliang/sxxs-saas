import { expect, type Page, test } from '@playwright/test';
import { CUSTOMER, loginAs } from './helpers/auth';

/**
 * 把一个可买商品加入购物车，返回商品名。
 *
 * 列表卡不再直接加购：多规格商品的正确路径是「去详情 → 选规格 → 加入购物车」，
 * 单规格商品在详情页不需要选规格，所以统一走详情页一条路径（两种商品都能覆盖）。
 */
async function addAnyProductToCart(page: Page): Promise<string> {
  await page.goto('/products');
  await page
    .getByRole('button', { name: '查看详情' })
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByRole('button', { name: '查看详情' }).first().click();
  await expect(page).toHaveURL(/\/products\/\d+/, { timeout: 30_000 });

  const title = (await page.locator('h3').first().innerText()).trim();

  // 多规格：每组选第一个可用值；单规格没有规格组，循环自然跳过
  const groups = page.locator('[data-testid="spec-group"]');
  const groupCount = await groups.count();
  for (let index = 0; index < groupCount; index += 1) {
    const options = groups.nth(index).locator('button:not([disabled])');
    if ((await options.count()) > 0) {
      await options.first().click();
    }
  }

  await page.getByTestId('add-to-cart').click();
  await expect(page.getByText('已加入购物车').first()).toBeVisible({
    timeout: 20_000,
  });
  return title;
}

/**
 * Buyer journey against the real backend (plan §18 #1, #6, #15):
 * browse -> detail -> cart -> checkout -> payment result, plus the address book.
 */

test.describe('portal: buyer journey', () => {
  test('browses products and opens a product detail page', async ({ page }) => {
    await loginAs(page, CUSTOMER);
    await page.goto('/products');

    await expect(page.locator('.ant-card').first()).toBeVisible({
      timeout: 30_000,
    });
    const detailLink = page.getByRole('button', { name: '查看详情' }).first();
    await expect(detailLink).toBeVisible({ timeout: 30_000 });
    await detailLink.click();

    await expect(page).toHaveURL(/\/products\/\d+/, {
      timeout: 30_000,
    });
    await expect(page.getByText('卖家：').first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: '加入购物车' }).first(),
    ).toBeVisible();
  });

  test('adds a product to the cart and sees it listed', async ({ page }) => {
    await loginAs(page, CUSTOMER);

    const name = await addAnyProductToCart(page);

    await page.goto('/portal/cart');
    await expect(
      page.getByText('购物车', { exact: false }).first(),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 });
  });

  test('checks out the cart and completes the mock payment', async ({
    page,
  }) => {
    await loginAs(page, CUSTOMER);

    // Make sure there is at least one line to settle.
    await addAnyProductToCart(page);

    await page.goto('/portal/cart');
    await page.getByRole('button', { name: '去结算' }).click();
    await expect(page.getByText('确认订单').first()).toBeVisible({
      timeout: 20_000,
    });

    await page.getByLabel('收货人').fill('E2E 收货人');
    await page.getByLabel('联系电话').fill('13900001111');
    await page.getByLabel('详细地址').fill('E2E 自动化路 1 号');
    await page.getByRole('button', { name: '提交订单' }).click();

    // Order created -> the app navigates to the payment result page.
    await expect(page).toHaveURL(/\/portal\/payment-result\?orderId=\d+/, {
      timeout: 40_000,
    });

    const payButton = page.getByRole('button', { name: '立即支付（模拟）' });
    if (await payButton.isVisible().catch(() => false)) {
      await payButton.click();
      await expect(page.getByText('支付成功').first()).toBeVisible({
        timeout: 30_000,
      });
    }
    await expect(page.getByText(/订单号/).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test('manages the address book', async ({ page }) => {
    await loginAs(page, CUSTOMER);
    await page.goto('/portal/addresses');

    await expect(page.getByText('我的收货地址').first()).toBeVisible({
      timeout: 30_000,
    });

    const unique = `E2E 地址 ${Date.now()}`;
    await page.getByRole('button', { name: '新增地址' }).first().click();
    await page.getByLabel('收货人').fill('地址测试');
    await page.getByLabel('联系电话').fill('13800002222');
    await page.getByLabel('省').fill('广东省');
    await page.getByLabel('市').fill('深圳市');
    await page.getByLabel('区').fill('南山区');
    await page.getByLabel('详细地址').fill(unique);
    await page.getByRole('button', { name: /保\s*存/ }).click();

    await expect(page.getByText(unique).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
