const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── Logger ───────────────────────────────────────────────────────────────────
const logFilePath = path.join(__dirname, 'run-log.txt');

function initLog() {
  fs.writeFileSync(logFilePath, `===== RUN STARTED: ${new Date().toISOString()} =====\n\n`);
}

function log(label, data) {
  const timestamp = new Date().toISOString();
  const divider = '─'.repeat(60);
  let entry = `\n${divider}\n[${timestamp}] ${label}\n${divider}\n`;

  if (typeof data === 'string') {
    entry += data + '\n';
  } else {
    entry += JSON.stringify(data, null, 2) + '\n';
  }

  fs.appendFileSync(logFilePath, entry);
  console.log(`[LOG] ${label}`);
}
// ─────────────────────────────────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function httpPost(options, body) {
  return new Promise((resolve, reject) => {
    const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.write(bodyString);
    req.end();
  });
}

// ─── Zalora Price Tracker Logic ──────────────────────────────────────────────
const ZALORA_URL = "https://www.zalora.com.my/p/habib-habib-1g-999-9-gold-bar-songket-collection-manufactured-by-lbma-goods-delivery-refiner-gold-4547012";
const TARGET_PRICE = 600.00;

async function getZaloraPrice() {
  try {
    const html = await httpGet(ZALORA_URL);

    // 1. Try to find meta description
    const metaMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
    let content = null;

    if (metaMatch && metaMatch[1]) {
      content = metaMatch[1];
    } else {
      // 2. Fallback to og:description
      const ogMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
      if (ogMatch && ogMatch[1]) {
        content = ogMatch[1];
      }
    }

    if (content) {
      // 3. Parse "NOW only 740.00"
      const priceMatch = content.match(/NOW only ([\d.]+)/);
      if (priceMatch) {
        return parseFloat(priceMatch[1]);
      }
      return null;
    }
    return null;
  } catch (err) {
    console.error('Error fetching Zalora price:', err.message);
    return null;
  }
}

function getProductName() {
  // Fallback logic similar to Python script
  return "HABIB 1g Gold Bar";
}

async function sendTelegramAlert(token, chatId, productName, price, productUrl) {
  // Construct the base message
  let message = `🚨 PRICE ALERT: ${productName} is currently RM ${price.toFixed(2)}.`;

  // Add "Buy Now!" if price is below target
  if (price <= TARGET_PRICE) {
    message += "\n\nBuy Now!";
  }

  // Add the link to the message
  message += `\n\nProduct Link: ${productUrl}`;

  await httpPost(
    {
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    },
    JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML'
    })
  );
}

async function run() {
  try {
    initLog();
    log('START', { message: 'Zalora Price Tracker Started' });

    const price = await getZaloraPrice();
    const productName = getProductName();
    const timestamp = new Date().toISOString();

    if (price === null) {
      log('ERROR', { message: 'Failed to extract price from Zalora' });
      throw new Error('Price extraction failed');
    }

    log('PRICE CHECK', { product: productName, price: price.toFixed(2) });

    // ALERT LOGIC (Always runs now, regardless of price)
    try {
      const telegramToken = process.env.TELEGRAM_TOKEN;
      const telegramChatId = process.env.TELEGRAM_CHAT_ID;

      if (telegramToken && telegramChatId) {
        // Pass ZALORA_URL as the last argument
        await sendTelegramAlert(telegramToken, telegramChatId, productName, price, ZALORA_URL);
        log('TELEGRAM ALERT SENT', { success: true });
      } else {
        log('CONFIG ERROR', { message: 'Missing TELEGRAM_TOKEN or TELEGRAM_CHAT_ID' });
      }
    } catch (err) {
      log('TELEGRAM ERROR', { message: err.message });
    }

    log('RUN COMPLETE', { finishedAt: new Date().toISOString() });

  } catch (err) {
    log('FATAL ERROR', { message: err.message, stack: err.stack });
    process.exit(1);
  }
}

// Execute
run().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});