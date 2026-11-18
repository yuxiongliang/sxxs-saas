import fs from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:8010';

const run = async () => {
  const lines = [];
  const log = (...a) => lines.push(a.join(' '));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  await page.goto(`${BASE}/user/login`);
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('ant.design');
  await page.locator('button.ant-btn-primary[type="submit"], button.ant-btn-primary').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/user/login'), { timeout: 45000 });
  await page.waitForTimeout(1500);

  await page.goto(`${BASE}/system/settings/payment`, { waitUntil: 'commit' }).catch(() => {});
  await page.waitForTimeout(5000);
  const labels = await page.locator('.ant-form-item-label label').allInnerTexts();
  log('支付页字段 =', labels.map((l) => l.trim()).filter(Boolean).join(' | '));
  log('有证书三件套 =',
    labels.some((l) => l.includes('应用公钥证书')) &&
    labels.some((l) => l.includes('支付宝公钥证书')) &&
    labels.some((l) => l.includes('支付宝根证书')));
  const diag = await page.getByText('支付诊断').count();
  log('诊断卡片 =', diag > 0);
  const body = await page.locator('body').innerText();
  log('显示缺字段 =', /缺\s*privateKey/.test(body) || body.includes('应用私钥为空'));
  await browser.close();
  return lines.join('\n');
};

run().then((t) => fs.writeFileSync('/tmp/cert_ui.txt', t));
