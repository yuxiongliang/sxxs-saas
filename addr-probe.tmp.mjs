import fs from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:8010';

const run = async () => {
  const lines = [];
  const log = (...a) => lines.push(a.join(' '));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const failed = [];
  page.on('response', (res) => {
    if (res.url().includes('/api/') && res.status() >= 400) {
      failed.push(`${res.status()} ${res.url().split('/api/v1')[1]}`);
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

  const unique = `级联验证路 ${Date.now()}`;
  await page.getByRole('button', { name: /新增地址/ }).first().click();
  await page.waitForTimeout(1200);
  await page.getByLabel('收货人').fill('级联测试');
  await page.getByLabel('联系电话').fill('13700003333');
  await page.locator('.ant-modal .ant-cascader').click();
  await page.waitForTimeout(900);
  await page.locator('.ant-cascader-menu').first().getByText('广东省').click();
  await page.waitForTimeout(300);
  await page.locator('.ant-cascader-menu').nth(1).getByText('深圳市').click();
  await page.waitForTimeout(300);
  await page.locator('.ant-cascader-menu').nth(2).getByText('南山区').click();
  await page.waitForTimeout(300);
  await page.getByLabel('详细地址').fill(unique);
  await page.getByRole('button', { name: /保\s*存/ }).click();
  await page.waitForTimeout(3000);

  const bodyText = await page.locator('body').innerText();
  log('列表里出现广东省深圳市南山区 =', bodyText.includes('广东省深圳市南山区'));
  log('列表里出现详细地址 =', bodyText.includes(unique));

  // 再编辑一次，确认级联回填
  const row = page.locator('.ant-table-row', { hasText: unique }).first();
  if (await row.count()) {
    await row.getByRole('button', { name: /编\s*辑/ }).click();
    await page.waitForTimeout(1500);
    const picked = await page
      .locator('.ant-modal .ant-cascader .ant-select-selection-item, .ant-modal .ant-cascader input')
      .first()
      .inputValue()
      .catch(() => '');
    const cascaderText = await page.locator('.ant-modal .ant-cascader').innerText();
    log('编辑回填（级联文本）=', cascaderText.replace(/\n/g, ' ').slice(0, 40) || picked);
    await page.getByRole('button', { name: /取\s*消/ }).last().click();
  } else {
    log('编辑回填 = 未找到该行（可能被分页/列表刷新）');
  }

  log('失败请求 =', failed.slice(0, 3).join(' ;; ') || '(无)');
  await browser.close();
  return lines.join('\n');
};

run().then((t) => fs.writeFileSync('/tmp/addr_probe.txt', t));
