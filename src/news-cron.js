const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');

const { GoogleGenAI } = require('@google/genai');
const gTTS = require('gtts');

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
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseRSS(xmlData) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const parsed = parser.parse(xmlData);

  const items = parsed.rss?.channel?.item || [];
  const itemsArray = Array.isArray(items) ? items : [items];

  return itemsArray.slice(0, 3).map(item => {
    let source = item.source;
    if (typeof source === 'object' && source['#text']) {
      source = source['#text'];
    }

    return {
      title:       item.title       || 'N/A',
      url:         item.link        || 'N/A',
      description: 'N/A',
      source:      source           || 'Google News',
      publishedAt: item.pubDate     || 'N/A'
    };
  });
}

function sendTelegramDocument(token, chatId, filePath, caption) {
  return new Promise((resolve, reject) => {
    const boundary = `----NodeFormBoundary${crypto.randomBytes(16).toString('hex')}`;
    const filename = path.basename(filePath);

    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendDocument`,
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Telegram JSON parse error: ${e.message}`)); }
      });
    });

    req.on('error', reject);
    req.write(`--${boundary}\r\n`);
    req.write(`Content-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`);
    req.write(`--${boundary}\r\n`);
    req.write(`Content-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`);
    req.write(`--${boundary}\r\n`);
    req.write(`Content-Disposition: form-data; name="document"; filename="${filename}"\r\n`);
    req.write(`Content-Type: text/plain\r\n\r\n`);

    const fileStream = fs.createReadStream(filePath);
    fileStream.on('data', (chunk) => req.write(chunk));
    fileStream.on('end', () => {
      req.write(`\r\n--${boundary}--\r\n`);
      req.end();
    });
    fileStream.on('error', (err) => { req.destroy(); reject(err); });
  });
}

function sendTelegramAudio(token, chatId, filePath) {
  return new Promise((resolve, reject) => {
    const boundary = `----NodeFormBoundary${crypto.randomBytes(16).toString('hex')}`;
    const filename = path.basename(filePath);

    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendAudio`,
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Telegram JSON parse error: ${e.message}`)); }
      });
    });

    req.on('error', reject);
    req.write(`--${boundary}\r\n`);
    req.write(`Content-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`);
    req.write(`--${boundary}\r\n`);
    req.write(`Content-Disposition: form-data; name="audio"; filename="${filename}"\r\n`);
    req.write(`Content-Type: audio/mpeg\r\n\r\n`);

    const fileStream = fs.createReadStream(filePath);
    fileStream.on('data', (chunk) => req.write(chunk));
    fileStream.on('end', () => {
      req.write(`\r\n--${boundary}--\r\n`);
      req.end();
    });
    fileStream.on('error', (err) => { req.destroy(); reject(err); });
  });
}

function getMYTDateTime() {
  return new Date().toLocaleString('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).replace(',', ' ·') + ' MYT';
}

async function run() {
  try {
    initLog();

    // ── STEP 1: Fetch RSS feeds ───────────────────────────────────────────────
    const RSS_URLS = [
      'https://news.google.com/rss/headlines/section/topic/WORLD?hl=en&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=Malaysia&hl=en-MY&gl=MY&ceid=MY:en',
      'https://news.google.com/rss/search?q=football+OR+soccer+OR+Premier+League+OR+Champions+League&hl=en&gl=US&ceid=US:en',
      'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en&gl=US&ceid=US:en'
    ];

    console.log('Fetching Google News RSS feeds...');
    const rawFeeds = await Promise.all(RSS_URLS.map(url => httpGet(url)));

    log('STEP 1 — RAW RSS (first 2000 chars of each feed)', {
      WORLD:    rawFeeds[0].slice(0, 2000),
      MALAYSIA: rawFeeds[1].slice(0, 2000),
      FOOTBALL: rawFeeds[2].slice(0, 2000),
      ECONOMIC: rawFeeds[3].slice(0, 2000)
    });

    // ── STEP 2: Parse RSS ─────────────────────────────────────────────────────
    const parsedFeeds = rawFeeds.map(xml => parseRSS(xml));

    const sections = [
      { label: 'GLOBAL',   emoji: '🌍', articles: parsedFeeds[0] },
      { label: 'MALAYSIA', emoji: '🇲🇾', articles: parsedFeeds[1] },
      { label: 'FOOTBALL', emoji: '⚽',  articles: parsedFeeds[2] },
      { label: 'ECONOMIC', emoji: '📈',  articles: parsedFeeds[3] }
    ];

    log('STEP 2 — PARSED ARTICLES', sections.map(s => ({
      section:  s.label,
      articles: s.articles.map(a => ({
        title:       a.title,
        source:      a.source,
        publishedAt: a.publishedAt,
        url:         a.url
      }))
    })));

    // ── STEP 3: Build newsText ────────────────────────────────────────────────
    let newsText = '';
    sections.forEach(section => {
      newsText += `\n[${section.label}]\n`;
      section.articles.slice(0, 3).forEach((article, i) => {
        newsText += `${i + 1}. Title: ${article.title}\n`;
        newsText += `   Description: ${article.description || 'N/A'}\n`;
        newsText += `   Source: ${article.source}\n`;
        newsText += `   URL: ${article.url}\n`;
        newsText += `   Published: ${article.publishedAt}\n\n`;
      });
    });

    log('STEP 3 — NEWS TEXT SENT TO GEMINI', newsText);
    console.log('Fetched and parsed news data successfully.');

    // ── STEP 4: Gemini generation ─────────────────────────────────────────────
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) throw new Error('Missing GEMINI_API_KEY');

    const ai = new GoogleGenAI({ apiKey: geminiApiKey });
    const sentAt = getMYTDateTime();

    const textPrompt = `You are a professional news editor writing a Telegram bulletin using Telegram HTML format.

STRICT RULES:
- Telegram only supports these HTML tags: <b>, <i>, <a href="...">, <code>. Nothing else.
- Use \\n for line breaks. Never use <br>, <hr>, <ul>, <li>, or any other tags.
- Output the bulletin as a single plain text string with \\n line breaks and the allowed HTML tags only.
- Do NOT wrap the output in any code block or quotes.
- Include ALL 12 articles across all 4 sections (3 per section). Do not skip any.
- For each article: write a bold headline, then 1-2 sentences of plain description, then the source as a clickable link.
- Use the exact article URL provided for the source link.

FORMAT TO FOLLOW EXACTLY (use \\n for line breaks):
<b>📰 Daily News Bulletin</b>
<i>🕗 ${sentAt}</i>

——————————————
<b>🌍 GLOBAL</b>
——————————————

<b>1. [Article 1 headline]</b>
[1-2 sentence description in plain text]
<a href="[article 1 URL]">📎 [Source Name]</a>

<b>2. [Article 2 headline]</b>
[1-2 sentence description in plain text]
<a href="[article 2 URL]">📎 [Source Name]</a>

<b>3. [Article 3 headline]</b>
[1-2 sentence description in plain text]
<a href="[article 3 URL]">📎 [Source Name]</a>

——————————————
<b>🇲🇾 MALAYSIA</b>
——————————————

[same structure for 3 Malaysia articles]

——————————————
<b>⚽ FOOTBALL</b>
——————————————

[same structure for 3 Football articles]

——————————————
<b>📈 ECONOMIC</b>
——————————————

[same structure for 3 Economic articles]

——————————————
<i>🎙 Full audio bulletin attached above · — Your Daily News Bot 🤖</i>

News articles to use:
${newsText}`;

    const voicePrompt = `You are a professional radio news reporter. Based on the following news articles, write a spoken English news bulletin (plain text only, no symbols, no HTML, no markdown, no asterisks). Target length: 8-10 minutes when read aloud at a natural pace (roughly 1200-1500 words).

Open with: "Good day, and welcome to your Daily News Bulletin. I am your news reporter, bringing you the latest headlines from around the world."

Cover ALL 12 articles across all 4 sections. Use these transitions:
- After global: "Moving on to news from Malaysia..."
- After Malaysia: "Now turning to the world of football..."
- After football: "And on the economic front..."

For each article spend 2-4 sentences: state what happened, why it matters, and any key detail.

Close with: "That is all for today's bulletin. Stay informed, stay ahead. Until next time."

News articles:
${newsText}`;

    console.log('Generating text and voice scripts via Gemini 2.5 Flash...');
    const [textResult, voiceResult] = await Promise.all([
      ai.models.generateContent({ model: 'gemini-2.5-flash', contents: textPrompt }),
      ai.models.generateContent({ model: 'gemini-2.5-flash', contents: voicePrompt })
    ]);

    const textSummary = textResult.text;
    const voiceScript = voiceResult.text;

    log('STEP 4a — GEMINI TEXT BULLETIN OUTPUT', textSummary);
    log('STEP 4b — GEMINI VOICE SCRIPT OUTPUT', voiceScript);

    // ── STEP 5: gTTS audio ────────────────────────────────────────────────────
    console.log('Synthesizing audio via gTTS...');

    const localAudioPath = path.join(__dirname, 'news-bulletin.mp3');

    if (fs.existsSync(localAudioPath)) fs.unlinkSync(localAudioPath);

    await new Promise((resolve, reject) => {
      const tts = new gTTS(voiceScript, 'en');
      tts.save(localAudioPath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    const audioSize = fs.statSync(localAudioPath).size;
    log('STEP 5 — AUDIO FILE', { path: localAudioPath, sizeBytes: audioSize });
    console.log(`Audio written to: ${localAudioPath} (${audioSize} bytes)`);

    // ── STEP 6: Send to Telegram ──────────────────────────────────────────────
    const telegramToken  = process.env.TELEGRAM_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;
    if (!telegramToken || !telegramChatId) throw new Error('Missing Telegram configuration tokens.');

    console.log('Sending HTML news bulletin to Telegram...');
    const textResponse = await httpPost(
      {
        hostname: 'api.telegram.org',
        path: `/bot${telegramToken}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      },
      JSON.stringify({
        chat_id:                telegramChatId,
        text:                   textSummary,
        parse_mode:             'HTML',
        disable_web_page_preview: true
      })
    );

    log('STEP 6a — TELEGRAM TEXT RESPONSE', textResponse);
    console.log('Telegram text message sent.');

    console.log('Uploading audio file to Telegram...');
    const audioResponse = await sendTelegramAudio(telegramToken, telegramChatId, localAudioPath);

    log('STEP 6b — TELEGRAM AUDIO RESPONSE', audioResponse);
    console.log('Done. Audio sent successfully.');

    // ── STEP 7: Send log file to Telegram ─────────────────────────────────────
    log('STEP 7 — RUN COMPLETE', { finishedAt: new Date().toISOString() });

    console.log('Sending run log to Telegram...');
    const logCaption = `📋 Run Log · ${getMYTDateTime()}`;
    const logResponse = await sendTelegramDocument(telegramToken, telegramChatId, logFilePath, logCaption);
    console.log('Log file sent to Telegram.');

  } catch (err) {
    const errorMsg = `ERROR: ${err.message}\n${err.stack}`;
    fs.appendFileSync(logFilePath, `\n${'─'.repeat(60)}\n[ERROR]\n${errorMsg}\n`);
    console.error('Execution halted:', err.message);

    // Try to send the error log to Telegram even on failure
    const telegramToken  = process.env.TELEGRAM_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;
    if (telegramToken && telegramChatId) {
      try {
        const errCaption = `❌ Run FAILED · ${getMYTDateTime()}\n${err.message}`;
        await sendTelegramDocument(telegramToken, telegramChatId, logFilePath, errCaption);
        console.log('Error log sent to Telegram.');
      } catch (telegramErr) {
        console.error('Could not send error log to Telegram:', telegramErr.message);
      }
    }

    process.exit(1);
  }
}

run();
