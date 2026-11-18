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

  /** 在确认页选一条地址（下拉第一项）。 */
  async function pickAddress(page: import('@playwright/test').Page) {
    await page.locator('.ant-select').first().click();
    await page.waitForTimeout(700);
    await page
      .locator('.ant-select-dropdown:visible .ant-select-item-option')
      .first()
      .click();
    await page.waitForTimeout(400);
  }

  test('checks out the cart on the standalone checkout page', async ({
    page,
  }) => {
    /**
     * 购物车「去结算」→ **独立确认页**（弹窗已下线）→ 余额支付 → 结果页。
     * 确认页要能看到商品清单 + 地址 + 支付方式，而不是只有一个弹窗表单。
     */
    await loginAs(page, CUSTOMER);
    await addAnyProductToCart(page);
    await ensureAddress(page);

    await page.goto('/portal/cart');
    await page.getByRole('button', { name: '去结算' }).click();

    await expect(page).toHaveURL(/\/portal\/checkout\?from=cart/, {
      timeout: 30_000,
    });
    await expect(page.getByText('商品清单').first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('收货信息').first()).toBeVisible();
    await expect(page.getByText('支付方式').first()).toBeVisible();

    await pickAddress(page);
    await page.getByTestId('checkout-submit').click();

    // 余额支付是即时的：提交后直接落到结果页
    await expect(page).toHaveURL(/\/portal\/payment-result\?orderId=\d+/, {
      timeout: 40_000,
    });
    await expect(page.getByText(/订单号/).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test('buy now goes straight to the checkout page (no cart detour)', async ({
    page,
  }) => {
    await loginAs(page, CUSTOMER);
    await ensureAddress(page);

    // 从商品列表进第一个商品详情
    await page.goto('/products');
    const cards = page.locator('[data-testid^="product-card-"]');
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });
    await cards.first().click();
    await page.waitForTimeout(3500);

    const buy = page.getByTestId('buy-now');
    if (!(await buy.isVisible().catch(() => false))) {
      // 多规格商品要先选规格，这条用例只用单规格；选不到就跳过，不制造假失败
      test.skip(true, '当前商品需要先选规格，跳过立即购买用例');
      return;
    }
    await buy.click();

    await expect(page).toHaveURL(/\/portal\/checkout\?skuId=\d+/, {
      timeout: 30_000,
    });
    await expect(page.getByText('商品清单').first()).toBeVisible({
      timeout: 30_000,
    });
    // 立即购买不写购物车：URL 里没有 cart
    expect(page.url()).not.toContain('/portal/cart');
  });

  test('checkout page asks for an address and a remark only', async ({
    page,
  }) => {
    /**
     * 确认页的输入只有「收货地址 + 备注」：
     * 姓名/电话/省市区/门牌都取自地址簿，两边各填一套会出现"下单用A、地址簿存B"。
     */
    await loginAs(page, CUSTOMER);
    await ensureAddress(page);

    await page.goto('/portal/checkout?skuId=9&quantity=1');
    await page.waitForTimeout(3500);

    await expect(page.getByText('商品清单').first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('收货地址').first()).toBeVisible();
    await expect(page.getByText('备注').first()).toBeVisible();
    await expect(page.getByText(/管理收货地址/).first()).toBeVisible();

    // 手填控件必须不存在
    await expect(page.locator('input#receiver_name')).toHaveCount(0);
    await expect(page.locator('input#receiver_phone')).toHaveCount(0);
    await expect(page.locator('input#receiver_address')).toHaveCount(0);
    await expect(page.locator('.ant-cascader')).toHaveCount(0);
  });

  test('portal tabs: open, close one, close all returns to overview', async ({
    page,
  }) => {
    /**
     * 买家中心顶部横向标签栏（菜单驱动）：
     * - 概览常驻不可关；
     * - 关掉当前标签 → 回概览；
     * - 「关闭全部」→ 回概览。
     */
    await loginAs(page, CUSTOMER);
    await page.goto('/portal', { waitUntil: 'commit' }).catch(() => undefined);
    await page.waitForTimeout(3000);

    const tabs = page.getByTestId('page-tabs');
    await expect(tabs).toBeVisible({ timeout: 30_000 });
    await expect(tabs.getByText('概览')).toBeVisible();

    await page.locator('.portal-sider').getByText('我的订单').click();
    await expect(page).toHaveURL(/\/portal\/orders/, { timeout: 20_000 });
    await expect(tabs.getByText('我的订单')).toBeVisible();

    // 关当前标签 → 回概览，标签也消失
    await page.locator('.ant-tabs-tab-active .ant-tabs-tab-remove').click();
    await expect(page).toHaveURL(/\/portal$/, { timeout: 20_000 });
    await expect(tabs.getByText('我的订单')).toHaveCount(0);

    // 再开一个 → 关闭全部 → 回概览
    await page.locator('.portal-sider').getByText('我的收藏').click();
    await expect(page).toHaveURL(/\/portal\/favorites/, { timeout: 20_000 });
    await page.getByTestId('page-tabs-close-all').click();
    await expect(page).toHaveURL(/\/portal$/, { timeout: 20_000 });
    await expect(tabs.getByText('我的收藏')).toHaveCount(0);
  });

  test('hovering the user name offers settings and logout', async ({
    page,
  }) => {
    /** 用户名不再是一行纯文本：悬停出「个人设置 / 退出登录」。 */
    await loginAs(page, CUSTOMER);
    await page.goto('/portal', { waitUntil: 'commit' }).catch(() => undefined);
    await page.waitForTimeout(2500);

    await page.getByTestId('portal-user-menu').hover();
    const dropdown = page.locator('.ant-dropdown:visible').first();
    await expect(dropdown).toBeVisible({ timeout: 15_000 });
    await expect(dropdown.getByText('个人设置')).toBeVisible();
    await expect(dropdown.getByText('退出登录')).toBeVisible();
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
