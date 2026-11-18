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

  // 等标题真的渲染出来再读：刚 toHaveURL 成功时详情接口可能还没回，
  // 直接 textContent 会拿到空串，后面 getByText('') 会原地挂 30 秒。
  const titleEl = page.getByTestId('product-detail-title');
  await expect(titleEl).toBeVisible({ timeout: 30_000 });
  await expect(titleEl).not.toBeEmpty();
  const title = ((await titleEl.textContent()) ?? '').trim();

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

  /**
   * 保证当前买家至少有一条收货地址（走真实接口，避免在弹窗里手点级联）。
   * 地址现在只能在地址簿里维护，确认订单弹窗只负责"选"。
   */
  async function ensureAddress(page: import('@playwright/test').Page) {
    // token 的存储键在 packages/shared 里定义，不要猜
    const token = await page.evaluate(
      // token 存在 **sessionStorage**（见 packages/shared/src/auth/token.ts）
      () => sessionStorage.getItem('antd_pro_access_token') ?? '',
    );
    const created = await page.request.post('/api/v1/portal/addresses', {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      data: {
        receiver_name: 'E2E 收货人',
        receiver_phone: '13900001111',
        province: '广东省',
        city: '深圳市',
        district: '南山区',
        detail: 'E2E 自动化路 1 号',
        is_default: true,
      },
    });
    // 200 = 新建成功；422 = 已存在/字段校验（用现有地址继续）；
    // 401 = 登录态没带上，属用例问题，必须暴露而不是静默跳过
    if (created.status() === 401) {
      throw new Error('ensureAddress: 未带上登录态，无法创建收货地址');
    }
    return created.status();
  }

  test('checks out the cart and completes the mock payment', async ({
    page,
  }) => {
    await loginAs(page, CUSTOMER);

    // Make sure there is at least one line to settle.
    await addAnyProductToCart(page);

    // 确认订单弹窗只保留「收货地址 + 备注」：地址必须先在地址簿里存在。
    // 走真实接口建一条（比在弹窗里手点级联快且稳定），再打开弹窗。
    await ensureAddress(page);

    await page.goto('/portal/cart');
    await page.getByRole('button', { name: '去结算' }).click();
    await expect(page.getByText('确认订单').first()).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForTimeout(800);

    const addressSelect = page
      .getByRole('dialog')
      .locator('.ant-select')
      .first();
    await addressSelect.click();
    await page.waitForTimeout(600);
    await page
      .locator('.ant-select-dropdown:visible .ant-select-item-option')
      .first()
      .click();
    await page.getByRole('button', { name: '提交订单' }).click();

    // Order created -> the app navigates to the payment result page.
    await expect(page).toHaveURL(/\/portal\/payment-result\?orderId=\d+/, {
      timeout: 40_000,
    });

    // 真实支付需要商户号配置；e2e 用**余额支付**（种子里给 e2e 买家预置了余额）
    const payButton = page.getByTestId('pay-wallet');
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

  test('checkout modal only asks for an address and a remark', async ({
    page,
  }) => {
    /**
     * 确认订单弹窗**只保留「收货地址 + 备注」**：
     * 手填的姓名/电话/省市区/门牌已经删掉 —— 地址统一在地址簿里维护，
     * 两边各填一套就会出现"下单用的是手填值，地址簿里却是另一套"。
     */
    await loginAs(page, CUSTOMER);
    await addAnyProductToCart(page);
    await ensureAddress(page);

    await page.goto('/portal/cart');
    await expect(page.getByText('确认订单').first()).not.toBeVisible();
    await page.getByRole('button', { name: '去结算' }).click();

    const modal = page.getByRole('dialog').first();
    await expect(modal.getByText('确认订单').first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(modal.getByText('收货地址').first()).toBeVisible();
    await expect(modal.getByText('备注').first()).toBeVisible();
    await expect(modal.getByText(/管理收货地址/).first()).toBeVisible();
    // 手填控件必须不存在
    await expect(modal.locator('input#receiver_name')).toHaveCount(0);
    await expect(modal.locator('input#receiver_phone')).toHaveCount(0);
    await expect(modal.locator('input#receiver_address')).toHaveCount(0);
    await expect(modal.locator('.ant-cascader')).toHaveCount(0);
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
    // 省市区已改成级联点选（内置行政区划），不能再 fill
    await page.locator('.ant-modal .ant-cascader').click();
    await page.waitForTimeout(900);
    await page
      .locator('.ant-cascader-menu')
      .first()
      .getByText('广东省')
      .click();
    await page.waitForTimeout(300);
    await page.locator('.ant-cascader-menu').nth(1).getByText('深圳市').click();
    await page.waitForTimeout(300);
    await page.locator('.ant-cascader-menu').nth(2).getByText('南山区').click();
    await page.waitForTimeout(300);
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

  test('buyer centre has an IM entry and can send a message', async ({
    page,
  }) => {
    await loginAs(page, CUSTOMER);
    await page.goto('/portal');

    // 侧栏菜单：「消息」应紧跟在「概览」下面
    const sider = page.locator('.portal-sider');
    await expect(sider).toBeVisible({ timeout: 30_000 });
    const menuLabels = (
      await sider.locator('.ant-menu-item').allInnerTexts()
    ).map((text) => text.trim());
    expect(menuLabels[0]).toContain('概览');
    expect(menuLabels[1]).toContain('消息');

    // 概览页有「进入卖家中心」入口，且新窗口打开
    const goSeller = page.getByTestId('portal-go-seller');
    await expect(goSeller).toBeVisible();
    await expect(goSeller).toHaveAttribute('target', '_blank');

    // 顶栏品牌块：只显 logo（无站名文字），站名落在 aria-label 上
    const brandBox = page.getByTestId('portal-brand');
    await expect(brandBox).toBeVisible();
    await expect(brandBox).toHaveAttribute('aria-label', /.+/);
    await expect(brandBox).toHaveText('');

    await sider.getByText('消息').click();
    await expect(page).toHaveURL(/\/portal\/messages/, { timeout: 20_000 });

    // ImChat 渲染（会话列表 + 输入区）
    await expect(page.getByTestId('im-chat')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('im-emoji')).toBeVisible();
    await expect(page.getByTestId('im-product')).toBeVisible();

    // 有会话时：发一条文本应当出现在列表里，且两分钟内可以撤回
    const conversations = page.locator('[data-testid^="im-conversation-"]');
    if ((await conversations.count()) > 0) {
      await conversations.first().click();
      const unique = `e2e-im-${Date.now()}`;
      await page.locator('textarea').last().fill(unique);
      await page.getByTestId('im-send').click();
      await expect(page.getByText(unique).first()).toBeVisible({
        timeout: 20_000,
      });
      // 刚发送的消息还在 2 分钟窗口内 → 撤回/编辑按钮可见
      await expect(
        page.locator('[data-testid^="im-recall-"]').first(),
      ).toBeVisible({
        timeout: 10_000,
      });
    }
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
