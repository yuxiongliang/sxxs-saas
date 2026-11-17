import fs from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:8001';

const run = async () => {
  const lines = [];
  const log = (...a) => lines.push(a.join(' '));
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.localStorage.setItem('umi_locale', 'zh-CN');
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1200 });

  await page.goto(`${BASE}/login`);
  await page.locator('#username').fill('root');
  await page.locator('#password').fill('Sxxs@Platform2026');
  await page.locator('button[type="submit"], button.ant-btn-primary').first().click();
  await page.waitForTimeout(5000);

  await page.goto(`${BASE}/services`, { waitUntil: 'commit' }).catch(() => {});
  await page.waitForTimeout(6000);

  const pwd = await page.locator('input[type="password"]').count();
  log('支付页密码框数量（密钥字段应为密码框）=', pwd);

  // 取值说明是否显示（environment 的 extra）
  const extras = await page.locator('.ant-form-item-extra').allInnerTexts();
  log('提示文案 =', extras.map((t) => t.trim()).filter(Boolean).slice(0, 4).join(' | '));

  // 存储 Tab 的分组标题
  await page.getByRole('tab', { name: '存储' }).click();
  await page.waitForTimeout(2500);
  const heads = await page.locator('.ant-card-head-title').allInnerTexts();
  log('存储分组标题 =', heads.map((t) => t.trim()).filter(Boolean).slice(0, 4).join(' / '));
  const storageLabels = await page.locator('.ant-form-item-label label').allInnerTexts();
  log('存储标签 =', storageLabels.map((t) => t.trim()).filter(Boolean).slice(0, 8).join(' | '));

  await browser.close();
  return lines.join('\n');
};

run().then((t) => fs.writeFileSync('/tmp/platform_probe3.txt', t));
