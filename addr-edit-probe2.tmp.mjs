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

  // 选一条已经有省市区的（级联测试）
  const row = page.locator('.ant-table-row', { hasText: '级联测试' }).first();
  log('找到目标行 =', (await row.count()) > 0);
  log('编辑前 =', (await row.innerText()).replace(/\s+/g, ' ').slice(0, 60));
  await row.getByRole('button', { name: /编\s*辑/ }).first().click();
  await page.waitForTimeout(1500);
  log('弹窗回填 =', (await page.locator('.ant-modal .ant-cascader').innerText()).replace(/\n/g, ' ').slice(0, 40));

  // 改成 浙江省 / 杭州市 / 西湖区（三级都要点）
  await page.locator('.ant-modal .ant-cascader').click();
  await page.waitForTimeout(700);
  await page.locator('.ant-cascader-menu').first().getByText('浙江省').click();
  await page.waitForTimeout(700);
  await page.locator('.ant-cascader-menu').nth(1).getByText('杭州市').first().click();
  await page.waitForTimeout(700);
  await page.locator('.ant-cascader-menu').nth(2).getByText('西湖区').first().click();
  await page.waitForTimeout(600);
  log('选择后控件文本 =', (await page.locator('.ant-modal .ant-cascader').innerText()).replace(/\n/g, ' ').slice(0, 40));

  await page.getByRole('button', { name: /保\s*存/ }).click();
  await page.waitForTimeout(3000);

  log('PUT 请求体 =', puts[0] ?? '(没有发出 PUT)');
  const err = await page.locator('.ant-form-item-explain-error').allInnerTexts();
  log('校验错误 =', err.join(' | ') || '(无)');
  const after = (await page.locator('.ant-table-row', { hasText: '级联测试' }).first().innerText())
    .replace(/\s+/g, ' ');
  log('编辑后列表 =', after.slice(0, 60));
  await browser.close();
  return lines.join('\n');
};

run().then((t) => fs.writeFileSync('/tmp/addr_edit_probe2.txt', t));
