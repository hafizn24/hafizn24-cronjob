const https = require('https');
const fs = require('fs');
const FormData = require('form-data');

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

Promise.resolve()
  .then(() => {
    const gNewsApiKey = process.env.GNEWS_API_KEY;
    
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

    return Promise.all(topicRequests.map(opts => httpGet(opts)));
  })
  .then((responses) => {
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

    console.log('Fetched');

    return newsText;
  })
  .then((newsText) => {
    const geminiApiKey = process.env.GEMINI_API_KEY;

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

    const textReq = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemma-4-26b-it:generateContent?key=${geminiApiKey}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    };

    const voiceReq = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemma-4-26b-it:generateContent?key=${geminiApiKey}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    };

    const textBody = JSON.stringify({
      contents: [{ parts: [{ text: textPrompt }] }]
    });

    const voiceBody = JSON.stringify({
      contents: [{ parts: [{ text: voicePrompt }] }]
    });

    return Promise.all([
      httpPost(textReq, textBody),
      httpPost(voiceReq, voiceBody)
    ]);
  })
  .then((results) => {
    const textSummary = results[0].candidates[0].content.parts[0].text;
    const voiceScript = results[1].candidates[0].content.parts[0].text;

    console.log('AI generated');

    const geminiApiKey = process.env.GEMINI_API_KEY;

    const ttsReq = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${geminiApiKey}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    };

    const ttsBody = JSON.stringify({
      contents: [{ parts: [{ text: voiceScript }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceName: 'Charon' }
      }
    });

    return httpPost(ttsReq, ttsBody)
      .then(ttsResponse => {
        const wavData = ttsResponse.candidates[0].content.parts[0].inlineData.data;
        const buffer = Buffer.from(wavData, 'base64');
        fs.writeFileSync('/tmp/news-bulletin.wav', buffer);
        console.log('TTS done');
        return textSummary;
      });
  })
  .then((textSummary) => {
    const telegramToken = process.env.TELEGRAM_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;

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

    return httpPost(sendMsgReq, msgBody);
  })
  .then(() => {
    console.log('Text sent');

    const telegramToken = process.env.TELEGRAM_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;

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

    return httpPostForm(sendAudioReq, form);
  })
  .then(() => {
    console.log('Audio sent');
  })
  .catch(err => {
    console.error(err.message);
    process.exit(1);
  });
