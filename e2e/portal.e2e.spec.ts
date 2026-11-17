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
    .getByTestId('product-card-title')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('product-card-title').first().click();
  await expect(page).toHaveURL(/\/products\/\d+/, { timeout: 30_000 });

  const title = ((await page.locator('h3').first().textContent()) ?? '').trim();

  // 多规格：每组选第一个可用值；单规格没有规格组，循环自然跳过。
  //
  // 必须**等规格区渲染完**再点：详情页首屏要等 SKU/规格接口回来，
  // 早一步数 `spec-group` 会得到 0，循环直接跳过，
  // 结果按钮一直置灰（多规格商品不选规格就是不能买）。
  await expect(page.getByTestId('add-to-cart')).toBeVisible({
    timeout: 30_000,
  });
  const groups = page.locator('[data-testid="spec-group"]');
  await groups
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => undefined);
  const groupCount = await groups.count();
  for (let index = 0; index < groupCount; index += 1) {
    const options = groups.nth(index).locator('button:not([disabled])');
    if ((await options.count()) > 0) {
      await options.first().click();
    }
  }

  // 选完规格后按钮必须可用；不可用说明商品真的买不了，让断言直接说话
  await expect(page.getByTestId('add-to-cart')).toBeEnabled({
    timeout: 15_000,
  });
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
    const detailLink = page.getByTestId('product-card-title').first();
    await expect(detailLink).toBeVisible({ timeout: 30_000 });
    await detailLink.click();

    await expect(page).toHaveURL(/\/products\/\d+/, {
      timeout: 30_000,
    });
    // 「卖家：xxx」Tag 已移到右侧店铺卡（只显示 username）
    await expect(page.getByTestId('shop-card')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId('shop-owner-username')).not.toBeEmpty();
    await expect(page.getByTestId('shop-customer-service')).toBeVisible();
    await expect(page.getByTestId('shop-visit')).toBeVisible();
    await expect(
      page.getByRole('button', { name: '加入购物车' }).first(),
    ).toBeVisible();
    // 副标题已全站下线：详情页不应再出现「自用闲置」这类副标题
    await expect(page.getByText('自用闲置，功能正常')).toHaveCount(0);
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

  test('favorites a product and sees it in the portal list', async ({
    page,
  }) => {
    await loginAs(page, CUSTOMER);
    await page.goto('/products');
    await page
      .getByTestId('product-card-title')
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('product-card-title').first().click();

    const productName = (
      (await page.locator('h3').first().textContent()) ?? ''
    ).trim();
    const toggle = page.getByTestId('favorite-toggle');
    await expect(toggle).toBeVisible({ timeout: 30_000 });

    // 幂等：上一轮跑过可能已经是「已收藏」，先取消再收藏，保证从干净态开始
    if (((await toggle.textContent()) ?? '').includes('已收藏')) {
      await toggle.click();
      await expect(toggle).toContainText('收藏', { timeout: 20_000 });
    }
    await toggle.click();
    await expect(toggle).toContainText('已收藏', { timeout: 20_000 });

    // 「我的收藏」里应该能看到这个商品（同一套接口，不靠本地状态）
    await page.goto('/portal/favorites');
    await expect(page.getByText(productName).first()).toBeVisible({
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

  test('searches and filters the product list', async ({ page }) => {
    await page.goto('/products');
    const cards = page.locator('[data-testid^="product-card-"]');
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });

    // 搜一个不存在的关键词：应该给出空结果，而不是把列表原样留着
    const search = page.getByPlaceholder('搜商品名 / 店铺 / 卖家');
    await search.fill('zzz-绝不存在的商品-zzz');
    await search.press('Enter');
    await expect(page.getByText('暂时还没有在售商品').first()).toBeVisible({
      timeout: 20_000,
    });

    // 清空筛选应该回到全部商品
    await page.getByRole('button', { name: /清空筛选/ }).click();
    await expect(cards.first()).toBeVisible({ timeout: 20_000 });
  });

  test('sorts the product list and keeps it in the URL', async ({ page }) => {
    await page.goto('/products');
    await expect(
      page.locator('[data-testid^="product-card-"]').first(),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('product-sort').click();
    await page.getByTitle('销量从高到低').click();

    // 筛选条件写进 URL，刷新/分享不丢
    await expect(page).toHaveURL(/sort=sold_desc/, { timeout: 20_000 });
  });

  test('renders the product list as a masonry with responsive columns', async ({
    page,
  }) => {
    await page.goto('/products');
    const masonry = page.getByTestId('product-masonry').first();
    await expect(masonry).toBeVisible({ timeout: 30_000 });

    // 列的断点：≥1440 → 5 列（默认桌面视口够宽就是 5）
    const columns = Number(await masonry.getAttribute('data-columns'));
    expect(columns).toBeGreaterThanOrEqual(2);
    expect(columns).toBeLessThanOrEqual(5);

    // 瀑布流卡片封面**不再是 1:1**（按图片原始比例，这才有错开效果）
    const cover = masonry.locator('[data-testid="product-card-cover"]').first();
    const aspect = await cover.evaluate(
      (el) => (el as HTMLElement).style.aspectRatio || '',
    );
    expect(aspect).toBe('');
  });

  test('detail page has tabs and a related-products rail', async ({ page }) => {
    await loginAs(page, CUSTOMER);
    await page.goto('/products');
    await page.getByTestId('product-card-title').first().click();
    await expect(page).toHaveURL(/\/products\/\d+/, { timeout: 30_000 });

    // 选项卡：商品详情 / 评价
    const tabs = page.locator('.ant-tabs-tab');
    await expect(tabs.first()).toBeVisible({ timeout: 30_000 });
    expect(await tabs.count()).toBe(2);

    // 左侧「猜你喜欢」存在
    await expect(page.getByTestId('related-products')).toBeVisible({
      timeout: 30_000,
    });

    // 切到评价：?tab=reviews 写进 URL（可深链）
    await tabs.nth(1).click();
    await expect(page).toHaveURL(/tab=reviews/, { timeout: 20_000 });
  });
});
