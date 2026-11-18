import fs from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:8010';

const run = async () => {
  const lines = [];
  const log = (...a) => lines.push(a.join(' '));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  const puts = [];
  page.on('request', (req) => {
    if (req.method() === 'PUT' && req.url().includes('/portal/addresses/')) {
      puts.push(req.postData() ?? '');
    }
  });

  await page.goto(`${BASE}/user/login`);
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('ant.design');
  await page.locator('button.ant-btn-primary[type="submit"], button.ant-btn-primary').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/user/login'), { timeout: 45000 });
  await page.waitForTimeout(1500);

  await page.goto(`${BASE}/portal/addresses`, { waitUntil: 'commit' }).catch(() => {});
  await page.waitForTimeout(4000);

  const rows = page.locator('.ant-table-row');
  log('地址条数 =', await rows.count());
  if ((await rows.count()) === 0) {
    await browser.close();
    return '没有地址可编辑';
  }

  const row = rows.first();
  const before = (await row.innerText()).replace(/\s+/g, ' ');
  log('编辑前 =', before.slice(0, 80));

  await row.getByRole('button', { name: /编\s*辑/ }).first().click();
  await page.waitForTimeout(1500);

  const cascaderText = await page.locator('.ant-modal .ant-cascader').innerText();
  log('弹窗级联回填 =', cascaderText.replace(/\n/g, ' ').slice(0, 40));

  // 换成北京/北京市/东城区
  await page.locator('.ant-modal .ant-cascader').click();
  await page.waitForTimeout(800);
  await page.locator('.ant-cascader-menu').first().getByText('北京市').click();
  await page.waitForTimeout(400);
  const menus = page.locator('.ant-cascader-menu');
  const menuCount = await menus.count();
  log('级联菜单数 =', menuCount);
  if (menuCount >= 2) {
    await menus.nth(1).getByText('北京市').first().click();
    await page.waitForTimeout(400);
  }
  if (menuCount >= 3) {
    await menus.nth(2).getByText('东城区').first().click();
  }
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: /保\s*存/ }).click();
  await page.waitForTimeout(3000);

  log('PUT 请求体 =', puts[0] ?? '(没有发出 PUT)');
  const after = (await rows.first().innerText()).replace(/\s+/g, ' ');
  log('编辑后列表 =', after.slice(0, 80));
  await browser.close();
  return lines.join('\n');
};

run().then((t) => fs.writeFileSync('/tmp/addr_edit_probe.txt', t));
