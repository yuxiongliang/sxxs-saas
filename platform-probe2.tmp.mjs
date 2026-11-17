import fs from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:8001';

const run = async () => {
  const lines = [];
  const log = (...a) => lines.push(a.join(' '));
  const browser = await chromium.launch();
  const context = await browser.newContext();
  // 直接锁中文，避免被浏览器语言带到 en-US
  await context.addInitScript(() => {
    window.localStorage.setItem('umi_locale', 'zh-CN');
  });
  const page = await context.newPage(1200, 1000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

  await page.goto(`${BASE}/login`);
  await page.locator('#username').fill('root');
  await page.locator('#password').fill('Sxxs@Platform2026');
  await page.locator('button[type="submit"], button.ant-btn-primary').first().click();
  await page.waitForTimeout(5000);

  log('=== 中文侧边栏 ===');
  const menu = await page.locator('.ant-pro-base-menu-inline-item-text').allInnerTexts();
  log('菜单 =', menu.map((m) => m.trim()).filter(Boolean).join(' / '));

  log('');
  log('=== /services 中文字段 ===');
  await page.goto(`${BASE}/services`, { waitUntil: 'commit' }).catch(() => {});
  await page.waitForTimeout(6000);
  log('页面有「服务配置中心」 =', await page.getByText('服务配置中心').count());
  const labels = await page
    .locator('.ant-form-item-label label')
    .allInnerTexts();
  log('标签数 =', labels.length);
  log('前 16 =', labels.slice(0, 16).map((l) => l.trim()).join(' | '));
  log('仍出现 environment =', labels.some((l) => l.trim() === 'environment'));
  const heads = await page.locator('.ant-card-head-title').allInnerTexts();
  log('分组标题 =', heads.map((t) => t.trim()).filter(Boolean).slice(0, 6).join(' / '));

  log('');
  log('=== /settings/platform ===');
  await page.goto(`${BASE}/settings/platform`, { waitUntil: 'commit' }).catch(() => {});
  await page.waitForTimeout(4000);
  const menu2 = await page.locator('.ant-pro-base-menu-inline-item-text').allInnerTexts();
  log('菜单 =', menu2.map((m) => m.trim()).filter(Boolean).join(' / '));

  log('');
  log('页面错误 =', errors.slice(0, 3).join(' ;; ') || '(无)');
  await browser.close();
  return lines.join('\n');
};

run().then((t) => fs.writeFileSync('/tmp/platform_probe2.txt', t));
