const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { GoogleGenAI } = require('@google/genai');
const gTTS = require('gtts');

function httpGet(options) {
  return new Promise((resolve, reject) => {
    https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
      });
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
    const gNewsApiKey = process.env.GNEWS_API_KEY;
    if (!gNewsApiKey) throw new Error('Missing GNEWS_API_KEY');

    const topicRequests = [
      {
        hostname: 'gnews.io',
        path: `/api/v4/top-headlines?topic=world&lang=en&country=any&max=3&apikey=${gNewsApiKey}`,
        method: 'GET'
      },
      {
        hostname: 'gnews.io',
        path: `/api/v4/search?q=Malaysia&lang=en&country=my&sortby=publishedAt&max=3&apikey=${gNewsApiKey}`,
        method: 'GET'
      },
      {
        hostname: 'gnews.io',
        path: `/api/v4/search?q=football+OR+soccer+OR+Premier+League+OR+Champions+League+OR+La+Liga+OR+FIFA&lang=en&country=any&sortby=publishedAt&max=3&apikey=${gNewsApiKey}`,
        method: 'GET'
      },
      {
        hostname: 'gnews.io',
        path: `/api/v4/top-headlines?topic=business&lang=en&country=any&max=3&apikey=${gNewsApiKey}`,
        method: 'GET'
      }
    ];

    console.log('Fetching news feed datasets...');
    const responses = await Promise.all(topicRequests.map(opts => httpGet(opts)));

    const sections = [
      { label: 'GLOBAL',   emoji: '🌍', articles: responses[0].articles || [] },
      { label: 'MALAYSIA', emoji: '🇲🇾', articles: responses[1].articles || [] },
      { label: 'FOOTBALL', emoji: '⚽', articles: responses[2].articles || [] },
      { label: 'ECONOMIC', emoji: '📈', articles: responses[3].articles || [] }
    ];

    let newsText = '';
    sections.forEach(section => {
      newsText += `\n[${section.label}]\n`;
      section.articles.slice(0, 3).forEach((article, i) => {
        newsText += `${i + 1}. Title: ${article.title}\n`;
        newsText += `   Description: ${article.description || 'N/A'}\n`;
        newsText += `   Source: ${article.source.name}\n`;
        newsText += `   URL: ${article.url}\n`;
        newsText += `   Published: ${article.publishedAt}\n\n`;
      });
    });

    console.log('Fetched news data successfully.');

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) throw new Error('Missing GEMINI_API_KEY');

    const ai = new GoogleGenAI({ apiKey: geminiApiKey });

    const sentAt = getMYTDateTime();

    // ─── Template A: Newspaper ────────────────────────────────────────────────
    // Telegram HTML supports only: <b>, <i>, <a href="">, <code>, <pre>
    // Do NOT use <hr>, <br/>, <h1>, <ul> etc. Use plain \n for line breaks.
    // Each article: bold title, 1-2 sentence description, source link.
    // ─────────────────────────────────────────────────────────────────────────
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

    console.log('Text generation successful. Synthesizing audio via gTTS...');

    const localAudioPath = path.join(__dirname, 'news-bulletin.mp3');

    await new Promise((resolve, reject) => {
      const tts = new gTTS(voiceScript, 'en');
      tts.save(localAudioPath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    console.log(`Audio written to: ${localAudioPath}`);

    const telegramToken = process.env.TELEGRAM_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;
    if (!telegramToken || !telegramChatId) throw new Error('Missing Telegram configuration tokens.');

    console.log('Sending HTML news bulletin to Telegram...');
    await httpPost(
      {
        hostname: 'api.telegram.org',
        path: `/bot${telegramToken}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      },
      JSON.stringify({
        chat_id: telegramChatId,
        text: textSummary,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    );
    console.log('Telegram text message sent.');

    console.log('Uploading audio file to Telegram...');
    await sendTelegramAudio(telegramToken, telegramChatId, localAudioPath);
    console.log('Done. Audio sent successfully.');

  } catch (err) {
    console.error('Execution halted:', err.message);
    process.exit(1);
  }
}

run();
