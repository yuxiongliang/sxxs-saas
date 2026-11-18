import fs from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:8010';

const run = async () => {
  const lines = [];
  const log = (...a) => lines.push(a.join(' '));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });

  await page.goto(`${BASE}/user/login`);
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('ant.design');
  await page.locator('button.ant-btn-primary[type="submit"], button.ant-btn-primary').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/user/login'), { timeout: 45000 });
  await page.waitForTimeout(1500);

  // 买家订单页：时间应精确到秒
  await page.goto(`${BASE}/portal/orders`, { waitUntil: 'commit' }).catch(() => {});
  await page.waitForTimeout(4000);
  const rowText = await page.locator('.ant-table-tbody tr.ant-table-row').first().innerText();
  const t1 = rowText.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  log('买家订单时间 =', t1 ? t1[0] : '(未找到秒)');

  // 控制台订单页
  await page.goto(`${BASE}/orders`, { waitUntil: 'commit' }).catch(() => {});
  await page.waitForTimeout(4000);
  const txt2 = await page.locator('.ant-table-tbody tr.ant-table-row').first().innerText();
  const t2 = txt2.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  log('控制台订单时间 =', t2 ? t2[0] : '(未找到秒)');

  // 审计页
  await page.goto(`${BASE}/system/audit`, { waitUntil: 'commit' }).catch(() => {});
  await page.waitForTimeout(4000);
  const txt3 = await page.locator('.ant-table-tbody tr.ant-table-row').first().innerText();
  const t3 = txt3.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  log('审计时间 =', t3 ? t3[0] : '(未找到秒)');

  // 支付页
  await page.goto(`${BASE}/portal/payment-result?orderId=58`, { waitUntil: 'commit' }).catch(() => {});
  await page.waitForTimeout(3500);
  const body = await page.locator('body').innerText();
  const idx = body.split('\n').findIndex((l) => l.includes('下单时间'));
  log('支付页下单时间 =', idx >= 0 ? body.split('\n').slice(idx, idx + 2).join(' ') : '(未找到)');
  log('支付页含 ISO =', /\d{4}-\d{2}-\d{2}T/.test(body));

  await browser.close();
  return lines.join('\n');
};

run().then((t) => fs.writeFileSync('/tmp/sec_probe.txt', t));
