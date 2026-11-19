import { expect, test } from '@playwright/test';
import { ADMIN, CUSTOMER, loginAs } from './helpers/auth';

/**
 * 时间控制（系统设置 → 基础设置 → 时间控制）。
 *
 * 这条链路串了四层，任何一层断了都该在这里挂：
 *   配置页保存 → 后端校验/生效 → 下单落 expires_at + 排 close_unpaid 任务
 *   → 买家订单列表显示「未支付将于 … 关闭」。
 */
test.describe('time control', () => {
  test('menu groups brand under 基础设置 and saves the four timers', async ({
    page,
  }) => {
    await loginAs(page, ADMIN);
    await page
      .goto('/system/settings/basic/time-control', {
        waitUntil: 'commit',
      })
      .catch(() => undefined);
    await page.waitForTimeout(3000);

    // 菜单层级：系统设置 → 基础设置 → 站点品牌 / 时间控制
    const menu = page.locator('.ant-menu').first();
    await expect(menu.getByText('基础设置')).toBeVisible({ timeout: 30_000 });
    await expect(menu.getByText('时间控制')).toBeVisible();

    await expect(page.getByTestId('time-control-physical')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('卖家发货时限')).toBeVisible();
    await expect(page.getByText(/自提：发货.*自动确认收货/)).toBeVisible();

    // 切自定义后填值保存（表单在「跟随系统」时是禁用的）
    await page.locator('.ant-segmented-item', { hasText: '自定义' }).click();
    await page.waitForTimeout(800);
    await page.locator('input[data-testid="tc-unpaid-days"]').fill('1');
    await page.locator('input[data-testid="tc-refund-days"]').fill('7');
    await page.getByTestId('time-control-save').click();
    await expect(page.getByText(/时间控制已保存/).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('a new unpaid order shows its auto-close deadline', async ({ page }) => {
    await loginAs(page, CUSTOMER);

    // 用真实接口建一个不支付的订单（买东西立即付款会拿不到「待支付」态）
    const created = await page.evaluate(async () => {
      const token = sessionStorage.getItem('antd_pro_access_token') ?? '';
      const res = await fetch('/api/v1/portal/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          items: [{ sku_id: 9, quantity: 1 }],
          receiver_name: 'E2E 倒计时',
          receiver_phone: '13900008888',
          receiver_address: { detail: 'E2E 测试路 9 号' },
        }),
      });
      return res.status;
    });
    expect(created).toBe(200);

    await page
      .goto('/portal/orders', { waitUntil: 'commit' })
      .catch(() => undefined);
    await page.waitForTimeout(3000);
    // 时效列出现「未支付将于 … 关闭」（截止时间来自服务端 expires_at）
    await expect(page.getByText(/未支付将于/).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
