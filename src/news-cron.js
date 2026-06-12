const https = require('https');
const fs = require('fs');
const FormData = require('form-data');
const { GoogleGenerativeAI } = require('@google/generative-ai');

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

function httpPostForm(options, form) {
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
    form.pipe(req);
  });
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

    const genAI = new GoogleGenerativeAI(geminiApiKey);
    
    // FIX: Using official standard model identifier mapping
    const textModel = genAI.getGenerativeModel({ model: 'gemma-4-26b-it' });
    const ttsModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-tts' });

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

    const [textResult, voiceResult] = await Promise.all([
      textModel.generateContent(textPrompt),
      textModel.generateContent(voicePrompt)
    ]);

    const textSummary = textResult.response.text();
    const voiceScript = voiceResult.response.text();

    console.log('AI Generation complete.');

    const ttsResponse = await ttsModel.generateContent({
      contents: [{ parts: [{ text: voiceScript }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceName: 'Charon' },
        speakingRate: 1.0,
        pitch: 0.0
      }
    });

    // FIX: Navigating correctly down the candidate parts array to capture the base64 content
    const audioPart = ttsResponse.response.candidates?.[0]?.content?.parts?.[0];
    const audioData = audioPart?.inlineData?.data;

    if (!audioData) {
      throw new Error('No audio data payload extracted from the TTS response structure.');
    }

    const buffer = Buffer.from(audioData, 'base64');
    fs.writeFileSync('/tmp/news-bulletin.wav', buffer);
    console.log('Audio file generated and saved locally.');

    const telegramToken = process.env.TELEGRAM_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;
    if (!telegramToken || !telegramChatId) throw new Error('Missing Telegram environment variables.');

    // Dispatch text summary
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
    console.log('Telegram message dispatched.');

    // Dispatch audio file
    const form = new FormData();
    form.append('chat_id', telegramChatId);
    form.append('audio', fs.createReadStream('/tmp/news-bulletin.wav'), {
      filename: 'news-bulletin.wav',
      contentType: 'audio/wav'
    });

    const sendAudioReq = {
      hostname: 'api.telegram.org',
      path: `/bot${telegramToken}/sendAudio`,
      method: 'POST',
      headers: form.getHeaders()
    };

    await httpPostForm(sendAudioReq, form);
    console.log('Telegram audio attachment dispatched completely.');

  } catch (err) {
    console.error('Execution halted:', err.message);
    process.exit(1);
  }
}

run();
