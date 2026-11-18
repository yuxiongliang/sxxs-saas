import fs from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:8010';

const run = async () => {
  const lines = [];
  const log = (...a) => lines.push(a.join(' '));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  const requests = [];
  page.on('request', (req) => {
    if (
      (req.method() === 'PUT' || req.method() === 'POST') &&
      req.url().includes('/portal/addresses')
    ) {
      requests.push(`${req.method()} ${req.url().split('/api/v1')[1]} ${req.postData() ?? ''}`);
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

  // 目标：省市区为空的旧地址（「亮」）
  const row = page.locator('.ant-table-row', { hasText: '亮' }).first();
  log('找到「亮」= ', (await row.count()) > 0);
  log('编辑前 =', (await row.innerText()).replace(/\s+/g, ' ').slice(0, 70));
  await row.getByRole('button', { name: /编\s*辑/ }).first().click();
  await page.waitForTimeout(1500);
  log('弹窗级联 =', (await page.locator('.ant-modal .ant-cascader').innerText()).replace(/\n/g, ' ').slice(0, 40));

  await page.locator('.ant-modal .ant-cascader').click();
  await page.waitForTimeout(700);
  await page.locator('.ant-cascader-menu').first().getByText('广东省').click();
  await page.waitForTimeout(700);
  await page.locator('.ant-cascader-menu').nth(1).getByText('深圳市').first().click();
  await page.waitForTimeout(700);
  const menus = await page.locator('.ant-cascader-menu').count();
  log('菜单数 =', menus);
  if (menus >= 3) {
    await page.locator('.ant-cascader-menu').nth(2).getByText('南山区').first().click();
  } else {
    log('第三级菜单没出现！');
  }
  await page.waitForTimeout(600);
  log('选择后 =', (await page.locator('.ant-modal .ant-cascader').innerText()).replace(/\n/g, ' ').slice(0, 40));

  await page.getByRole('button', { name: /保\s*存/ }).click();
  await page.waitForTimeout(3000);

  log('发出的请求 =', requests.slice(0, 2).join(' ;; ') || '(没有请求)');
  const err = await page.locator('.ant-form-item-explain-error').allInnerTexts();
  log('校验错误 =', err.join(' | ') || '(无)');
  const after = (await page.locator('.ant-table-row', { hasText: '亮' }).first().innerText())
    .replace(/\s+/g, ' ');
  log('编辑后列表 =', after.slice(0, 70));
  await browser.close();
  return lines.join('\n');
};

run().then((t) => fs.writeFileSync('/tmp/addr_empty_probe.txt', t));
