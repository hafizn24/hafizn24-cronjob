const { GoogleGenerativeAI } = require('@google/generative-ai');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemma-4-26b-a4b-it' });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_API_BASE  = process.env.TELEGRAM_API_BASE_URL || 'https://api.telegram.org';

const SHOPEE_URL = 'https://shopee.com.my/product/165219042/49302992644?d_id=2f6f6&uls_trackid=55vv4lf200lr';
const TARGET_PRICE  = 600.00;
const PRODUCT_NAME  = 'HABIB 1g 999.9 Gold Bar';

// ─── Logger ───────────────────────────────────────────────────────────────────
const logFilePath = path.join(__dirname, 'run-log.txt');

function initLog() {
  fs.writeFileSync(logFilePath, `===== RUN STARTED: ${new Date().toISOString()} =====\n\n`);
}

function log(label, data) {
  const timestamp = new Date().toISOString();
  const divider = '─'.repeat(60);
  let entry = `\n${divider}\n[${timestamp}] ${label}\n${divider}\n`;
  entry += (typeof data === 'string' ? data : JSON.stringify(data, null, 2)) + '\n';
  fs.appendFileSync(logFilePath, entry);
  console.log(`[LOG] ${label}`, typeof data === 'string' ? data : JSON.stringify(data));
}

// ─── Screenshot ───────────────────────────────────────────────────────────────
async function getProductScreenshotBase64() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  try {
    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    await page.setViewport({ width: 1280, height: 900 });

    // Block heavy assets to speed up load
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['font', 'media'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log('🌐 Navigating to Shopee product page...');
    try {
      await page.goto(SHOPEE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (e) {
      console.log('⚠️ Page load timed out, proceeding with available content...');
    }

    // Wait a moment for price elements to render
    await new Promise(r => setTimeout(r, 3000));

    console.log('📸 Taking screenshot...');
    const base64 = await page.screenshot({ encoding: 'base64', fullPage: false });
    return base64;

  } finally {
    await browser.close();
  }
}

// ─── AI Price Extraction ──────────────────────────────────────────────────────
async function extractPriceWithAI(base64Image) {
  const prompt = `
You are a price extractor. Look at this Shopee product page screenshot and reply with ONLY the following block, nothing else, no explanation:

PRICE: [number only, e.g. 740.00]
ORIGINAL_PRICE: [number only if crossed out/discounted, else NONE]
IN_STOCK: [Yes/No]
PRODUCT_NAME: [full product name as shown]

Do not add any other text before or after this block.`;

  const result = await model.generateContent([
    { inlineData: { data: base64Image, mimeType: 'image/png' } },
    prompt
  ]);

  const text = result.response.text().trim();
  console.log('🤖 AI response:\n', text);
  return text;
}

function parsePriceFromAIResponse(text) {
  const priceMatch = text.match(/PRICE:\s*([\d.]+)/i);
  if (!priceMatch) return null;
  return parseFloat(priceMatch[1]);
}

// ─── Telegram ─────────────────────────────────────────────────────────────────
async function sendTelegramAlert(price) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
  }

  const timestamp = new Date().toLocaleString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    timeStyle: 'short',
    dateStyle: 'full'
  });

  const belowTarget = price <= TARGET_PRICE;

  let message =
    `${belowTarget ? '🚨' : '📊'} <b>Shopee Price Alert</b>\n` +
    `📦 ${PRODUCT_NAME}\n` +
    `🕐 ${timestamp} MYT\n\n` +
    `💰 Current Price: <b>RM ${price.toFixed(2)}</b>\n` +
    `🎯 Target Price:  RM ${TARGET_PRICE.toFixed(2)}\n`;

  if (belowTarget) {
    message += `\n✅ <b>Price is at or below your target! Buy Now!</b>\n`;
  }

  message += `\n🔗 <a href="${SHOPEE_URL}">View Product</a>`;

  const url = `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Telegram API error: ${response.status} — ${errorText}`);
  }

  const result = await response.json();
  console.log('✅ Telegram alert sent:', result.ok);
  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  initLog();
  log('START', 'Shopee Price Tracker Started');
  console.log('🎯 Run started at', new Date().toISOString());

  try {
    // 1. Screenshot
    const base64Image = await getProductScreenshotBase64();
    log('SCREENSHOT', 'Captured successfully');

    // 2. AI extraction
    console.log('🤖 Sending screenshot to Gemma 4 for price extraction...');
    const aiResponse = await extractPriceWithAI(base64Image);
    log('AI RESPONSE', aiResponse);

    // 3. Parse price
    const price = parsePriceFromAIResponse(aiResponse);
    if (price === null) {
      log('ERROR', 'AI could not extract price from screenshot');
      throw new Error('Price extraction failed');
    }

    log('PRICE CHECK', { product: PRODUCT_NAME, price: price.toFixed(2), target: TARGET_PRICE.toFixed(2) });

    // 4. Send Telegram
    try {
      await sendTelegramAlert(price);
      log('TELEGRAM ALERT SENT', { success: true, price: price.toFixed(2) });
    } catch (err) {
      log('TELEGRAM ERROR', { message: err.message });
      throw err;
    }

    log('RUN COMPLETE', { finishedAt: new Date().toISOString() });
    console.log('✅ Done!');

  } catch (err) {
    log('FATAL ERROR', { message: err.message, stack: err.stack });
    console.error('❌ Fatal error:', err.message);
    process.exit(1);
  }
}

run();