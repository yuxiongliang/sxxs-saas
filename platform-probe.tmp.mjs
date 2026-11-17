import fs from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:8001';

const run = async () => {
  const lines = [];
  const log = (...a) => lines.push(a.join(' '));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

  await page.goto(`${BASE}/login`);
  await page.locator('#username').fill('root');
  await page.locator('#password').fill('Sxxs@Platform2026');
  await page.locator('button[type="submit"], button.ant-btn-primary').first().click();
  await page.waitForTimeout(5000);
  log('登录后 URL =', page.url());

  log('');
  log('=== 侧边栏菜单 ===');
  const menu = await page.locator('.ant-menu-item, .ant-pro-base-menu-inline-item-text')
    .allInnerTexts();
  log('菜单项 =', menu.map((m) => m.trim()).filter(Boolean).join(' / '));
  log('还有 platformSetting 原文 =', menu.some((m) => m.includes('platformSetting')));
  log('还有裸 jobs =', menu.some((m) => m.trim() === 'jobs'));

  log('');
  log('=== /services 字段标签 ===');
  await page.goto(`${BASE}/services`, { waitUntil: 'commit' }).catch(() => {});
  await page.waitForTimeout(5000);
  const labels = await page.locator('.ant-tabs-tabpane-active .ant-form-item-label label').allInnerTexts();
  log('支付页标签前 12 =', labels.slice(0, 12).map((l) => l.trim()).join(' | '));
  log('仍是 environment =', labels.some((l) => l.trim() === 'environment'));
  const groupTitles = await page.locator('.ant-tabs-tabpane-active .ant-card-head-title').allInnerTexts();
  log('分组标题 =', groupTitles.map((t) => t.trim()).join(' / '));

  // 切到短信 Tab 看是否也中文
  await page.getByRole('tab', { name: '短信' }).click();
  await page.waitForTimeout(2500);
  const smsLabels = await page.locator('.ant-tabs-tabpane-active .ant-form-item-label label').allInnerTexts();
  log('短信页标签 =', smsLabels.slice(0, 9).map((l) => l.trim()).join(' | '));

  log('');
  log('=== /settings/platform 侧栏 ===');
  await page.goto(`${BASE}/settings/platform`, { waitUntil: 'commit' }).catch(() => {});
  await page.waitForTimeout(4000);
  const menu2 = await page.locator('.ant-pro-base-menu-inline-item-text').allInnerTexts();
  log('菜单 =', menu2.map((m) => m.trim()).filter(Boolean).join(' / '));

  log('');
  log('页面错误 =', errors.slice(0, 3).join(' ;; ') || '(无)');
  await browser.close();
  return lines.join('\n');
};

run().then((t) => fs.writeFileSync('/tmp/platform_probe.txt', t));
