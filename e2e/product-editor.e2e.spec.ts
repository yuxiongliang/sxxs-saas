import { expect, test } from '@playwright/test';
import { ADMIN, loginAs } from './helpers/auth';

/**
 * 商品编辑器（运营端弹窗）回归。
 *
 * 这里锁的是一个**已经复发过两次**的 bug：编辑器是两步表单，
 * 切到第 2 步（规格）时如果 `<Form>` 被卸载，antd 的字段 store 就没了，
 * 而「保存」按钮只在第 2 步出现 —— 点保存时主图/视频/名称等基础字段读不到，
 * 提交上去是空串，反而把库里的图**清空**。用户看到的现象就是「选了图保存无效，
 * 重开是空的」。
 */
test.describe('product editor (admin)', () => {
  test('main image survives switching steps and is saved', async ({ page }) => {
    await loginAs(page, ADMIN);
    await page
      .goto('/commerce/products/list', { waitUntil: 'commit' })
      .catch(() => undefined);
    await page.waitForTimeout(4500);

    // 等表格出来再点第一行的「编辑」
    const editButton = page.getByRole('button', { name: /编\s*辑/ }).first();
    await expect(editButton).toBeVisible({ timeout: 30_000 });
    await editButton.click();
    await page.waitForTimeout(3000);

    const modal = page.getByRole('dialog', { name: /编辑商品/ }).first();
    await expect(modal).toBeVisible({ timeout: 30_000 });

    // 选一张图（附件中心：单击选中 → 使用选中的图片）
    await page.locator('button:has-text("选择图片")').first().click();
    await page.waitForTimeout(1500);
    await page
      .getByRole('dialog')
      .last()
      .locator('button:has(img)')
      .first()
      .click();
    await page.locator('button:has-text("使用选中的图片")').click();
    await page.waitForTimeout(1000);

    const slot = page
      .getByTestId('media-field-image')
      .first()
      .locator('img')
      .first();
    await expect(slot).toBeVisible({ timeout: 15_000 });
    const picked = await slot.getAttribute('src');
    expect(picked).toBeTruthy();

    // 切到第 2 步再切回来：值不能丢
    await page.locator('button:has-text("下一步")').first().click();
    await page.waitForTimeout(600);
    await page.locator('button:has-text("上一步")').first().click();
    await page.waitForTimeout(600);
    expect(await slot.getAttribute('src')).toBe(picked);

    // 第 2 步保存
    await page.locator('button:has-text("下一步")').first().click();
    await page.waitForTimeout(600);
    const saved = page.waitForResponse(
      (res) =>
        res.request().method() === 'PUT' &&
        /\/api\/v1\/admin\/products\/\d+$/.test(res.url()),
      { timeout: 30_000 },
    );
    await page
      .locator('button:has-text("保 存"), button:has-text("保存")')
      .first()
      .click();
    const response = await saved;
    expect(response.status()).toBe(200);

    // 请求体里必须真的带上 main_image，而不是空串
    const body = JSON.parse(response.request().postData() ?? '{}');
    expect(body.main_image).toBeTruthy();
    expect(body.main_image).toContain('/api/v1/attachments/public/');
  });
});
