import { chromium } from 'playwright';

const address = process.argv[2];
if (!address) { console.error('need address'); process.exit(1); }

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', (msg) => { if (msg.type() === 'error') console.log('PAGE ERROR:', msg.text().slice(0,200)); });
await page.goto('https://faucet.flare.network/coston2', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3000);

// fill the address input
const inputs = page.locator('input');
const count = await inputs.count();
console.log('inputs found:', count);
for (let i = 0; i < count; i++) {
  const el = inputs.nth(i);
  const placeholder = (await el.getAttribute('placeholder')) || '';
  const type = (await el.getAttribute('type')) || '';
  if (placeholder.toLowerCase().includes('address') || type === 'text' || type === '') {
    await el.fill(address);
    console.log('filled input', i, 'placeholder:', placeholder);
    break;
  }
}
await page.waitForTimeout(1000);

// click C2FLR request
const buttons = page.getByRole('button');
const btnCount = await buttons.count();
console.log('buttons:', btnCount);
for (let i = 0; i < btnCount; i++) {
  const text = (await buttons.nth(i).textContent()) || '';
  if (text.includes('C2FLR') || text.includes('Request')) {
    console.log('clicking button:', text.trim());
    await buttons.nth(i).click();
    break;
  }
}
await page.waitForTimeout(8000);
const bodyText = await page.locator('body').textContent();
const idx = bodyText.indexOf('Recaptcha');
const success = /success|sent|received|paid|approved|requested/i.test(bodyText) && !/error/i.test(bodyText.slice(0, 2000));
console.log('RESULT:', success ? 'SUCCESS' : 'CHECK_MANUALLY');
console.log('body snippet:', bodyText.replace(/\s+/g,' ').slice(0, 500));
await browser.close();
