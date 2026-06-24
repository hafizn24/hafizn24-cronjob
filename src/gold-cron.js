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
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-MY,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache'
      }
    };

    const req = https.request(options, (res) => {
      // Follow redirects
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) {
        const location = res.headers.location;
        if (!location) return reject(new Error('Redirect with no location header'));
        const redirectUrl = location.startsWith('http') ? location : `https://${parsed.hostname}${location}`;
        console.log(`Redirecting to: ${redirectUrl}`);
        return resolve(httpGet(redirectUrl));
      }

      console.log(`Response status: ${res.statusCode}`);
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.end();
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
    console.log(`Fetching URL: ${ZALORA_URL}`);
    const html = await httpGet(ZALORA_URL);
    console.log(`HTML received. Length: ${html.length} chars`);

    // Log a snippet to help debug if price extraction fails
    if (html.length < 5000) {
      console.log('--- HTML SNIPPET (first 2000 chars) ---');
      console.log(html.substring(0, 2000));
      console.log('--- END SNIPPET ---');
    }

    // 1. Try meta description
    const metaMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
    let content = null;

    if (metaMatch && metaMatch[1]) {
      content = metaMatch[1];
      console.log(`Meta description found: ${content}`);
    } else {
      // 2. Fallback to og:description
      const ogMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
      if (ogMatch && ogMatch[1]) {
        content = ogMatch[1];
        console.log(`OG description found (fallback): ${content}`);
      }
    }

    if (content) {
      // 3. Parse "NOW only 740.00"
      const priceMatch = content.match(/NOW only ([\d.]+)/);
      if (priceMatch) {
        const price = parseFloat(priceMatch[1]);
        console.log(`Price extracted: RM ${price}`);
        return price;
      }

      // 4. Broader fallback: any RM price pattern in the full HTML
      console.log('Price pattern not found in meta/og description. Trying full HTML fallback...');
    }

    // 5. Last resort: scan full HTML for price patterns
    const htmlPriceMatch = html.match(/["']price["']\s*:\s*["']([\d.]+)["']/i)
      || html.match(/RM\s*([\d,]+\.?\d*)/i)
      || html.match(/NOW only ([\d.]+)/i);

    if (htmlPriceMatch) {
      const price = parseFloat(htmlPriceMatch[1].replace(',', ''));
      console.log(`Price extracted from HTML fallback: RM ${price}`);
      return price;
    }

    console.log('Price extraction failed — no pattern matched.');
    return null;

  } catch (err) {
    console.error('Error fetching Zalora price:', err.message);
    return null;
  }
}

function getProductName() {
  return "HABIB 1g Gold Bar";
}

async function sendTelegramAlert(token, chatId, productName, price, productUrl) {
  let message = `🚨 PRICE ALERT: ${productName} is currently RM ${price.toFixed(2)}.`;

  if (price <= TARGET_PRICE) {
    message += "\n\n🟢 Buy Now! Price is at or below your target!";
  }

  message += `\n\n🔗 Product Link: ${productUrl}`;

  console.log(`Sending Telegram message: ${message}`);

  const result = await httpPost(
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

  if (!result.ok) {
    throw new Error(`Telegram API error: ${JSON.stringify(result)}`);
  }

  return result;
}

async function run() {
  try {
    initLog();
    log('START', { message: 'Zalora Price Tracker Started' });

    const price = await getZaloraPrice();
    const productName = getProductName();

    if (price === null) {
      log('ERROR', { message: 'Failed to extract price from Zalora' });
      throw new Error('Price extraction failed');
    }

    log('PRICE CHECK', { product: productName, price: price.toFixed(2), target: TARGET_PRICE.toFixed(2) });

    const telegramToken = process.env.TELEGRAM_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;

    if (telegramToken && telegramChatId) {
      try {
        await sendTelegramAlert(telegramToken, telegramChatId, productName, price, ZALORA_URL);
        log('TELEGRAM ALERT SENT', { success: true });
      } catch (err) {
        log('TELEGRAM ERROR', { message: err.message });
      }
    } else {
      log('CONFIG ERROR', { message: 'Missing TELEGRAM_TOKEN or TELEGRAM_CHAT_ID env vars' });
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