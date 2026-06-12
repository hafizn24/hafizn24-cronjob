const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load the unified GenAI SDK
const { GoogleGenAI } = require('@google/genai');

/**
 * Native Promise wrapper for HTTPS GET requests
 */
function httpGet(options) {
  return new Promise((resolve, reject) => {
    https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Native Promise wrapper for standard HTTPS POST requests (JSON payloads)
 */
function httpPost(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Sends a local file binary to Telegram Bot API using a raw Multipart FormData implementation
 */
function sendTelegramAudio(token, chatId, filePath) {
  return new Promise((resolve, reject) => {
    const boundary = `----NodeFormBoundary${crypto.randomBytes(16).toString('hex')}`;
    const filename = path.basename(filePath);
    
    // Construct HTTP headers
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendAudio`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Telegram JSON parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);

    // Build Form Content Elements manually in memory safely
    req.write(`--${boundary}\r\n`);
    req.write(`Content-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`);

    req.write(`--${boundary}\r\n`);
    req.write(`Content-Disposition: form-data; name="audio"; filename="${filename}"\r\n`);
    req.write(`Content-Type: audio/wav\r\n\r\n`);

    // Stream out binary content blocks directly
    const fileStream = fs.createReadStream(filePath);
    fileStream.on('data', (chunk) => req.write(chunk));
    fileStream.on('end', () => {
      req.write(`\r\n--${boundary}--\r\n`);
      req.end();
    });
    fileStream.on('error', (err) => {
      req.destroy();
      reject(err);
    });
  });
}

async function run() {
  try {
    const gNewsApiKey = process.env.GNEWS_API_KEY;
    if (!gNewsApiKey) throw new Error('Missing GNEWS_API_KEY');

    // Prepare API requests targeting GNews API points
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
      { label: 'GLOBAL NEWS', articles: responses[0].articles || [] },
      { label: 'MALAYSIA NEWS', articles: responses[1].articles || [] },
      { label: 'FOOTBALL NEWS', articles: responses[2].articles || [] },
      { label: 'ECONOMIC NEWS', articles: responses[3].articles || [] }
    ];

    let newsText = '';
    sections.forEach(section => {
      newsText += `\n${section.label}\n`;
      section.articles.slice(0, 3).forEach(article => {
        newsText += `Title: ${article.title}\n`;
        newsText += `Description: ${article.description || 'N/A'}\n`;
        newsText += `Source: ${article.source.name}\n`;
        newsText += `Published: ${article.publishedAt}\n\n`;
      });
    });

    console.log('Fetched news data successfully.');

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) throw new Error('Missing GEMINI_API_KEY in environment variables.');

    // Initialize modern SDK configuration exclusively
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });

    const textPrompt = `You are a professional news editor. Based on the following news articles, create a Telegram HTML formatted bulletin using <b>, <i>, and emojis. Use numbered lists. Length: 350-450 words.

Open with: <b>📰 Daily News Bulletin</b>
Close with: <i>— Your Daily News Bot 🤖</i>

News articles:
${newsText}`;

    const voicePrompt = `You are a professional radio news reporter. Based on the following news articles, create a spoken English news bulletin (plain text, no symbols, no HTML, no markdown). Length: 350-450 words.

Open with: "Good day, and welcome to your Daily News Bulletin. I am your news reporter, bringing you the latest headlines from around the world."
Use transitions like: "Moving on to Malaysia...", "In football news...", "On the economic front..."
Close with: "That is all for today's bulletin. Stay informed, stay ahead. Until next time."

News articles:
${newsText}`;

    console.log('Generating text scripts using Gemini 2.5 Flash...');
    const [textResult, voiceResult] = await Promise.all([
      ai.models.generateContent({ model: 'gemini-2.5-flash', contents: textPrompt }),
      ai.models.generateContent({ model: 'gemini-2.5-flash', contents: voicePrompt })
    ]);

    // Extract strings effortlessly using the new SDK standard property directly
    const textSummary = textResult.text;
    const voiceScript = voiceResult.text;

    console.log('Text generation successful. Synthesizing audio via Gemini 2.5 Flash TTS...');

    // Generate native audio payloads using the correct specialized TTS model
    const ttsResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash-tts',
      contents: voiceScript,
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } }
        }
      }
    });

    // Safely pull base64 audio bytes out from inside the unified response structure
    const audioPart = ttsResponse.candidates?.[0]?.content?.parts?.[0];
    const audioData = audioPart?.inlineData?.data;

    if (!audioData) {
      throw new Error('No audio data payload extracted from the TTS response.');
    }

    const localAudioPath = path.join(__dirname, 'news-bulletin.wav');
    fs.writeFileSync(localAudioPath, Buffer.from(audioData, 'base64'));
    console.log(`Audio binary written smoothly out to: ${localAudioPath}`);

    const telegramToken = process.env.TELEGRAM_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;
    if (!telegramToken || !telegramChatId) throw new Error('Missing Telegram configuration tokens.');

    // Dispatch the text bulletin to Telegram
    console.log('Sending HTML news summary to Telegram...');
    const sendMsgReq = {
      hostname: 'api.telegram.org',
      path: `/bot${telegramToken}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    };

    const msgBody = JSON.stringify({
      chat_id: telegramChatId,
      text: textSummary,
      parse_mode: 'HTML'
    });

    await httpPost(sendMsgReq, msgBody);
    console.log('Telegram HTML text message dispatched safely.');

    // Dispatch the audio file attachment to Telegram using native multipart handling
    console.log('Uploading generated audio file stream...');
    await sendTelegramAudio(telegramToken, telegramChatId, localAudioPath);
    console.log('Telegram process completed completely.');

  } catch (err) {
    console.error('Execution halted unexpectedly:', err.message);
    process.exit(1);
  }
}

run();
