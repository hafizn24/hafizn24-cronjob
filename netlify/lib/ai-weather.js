const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// ── Telegram Config ─────────────────────────────────────
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ── Get Weather from Gemini (Grounded) ──────────────────
async function getWeather(location = 'Subang Jaya') {
  const prompt = `
    Current weather in ${location}.

    Return ONLY JSON:
    {
    "condition": "string",
    "temperature": number,
    "humidity": number,
    "precip_mm": number,
    "is_rain": boolean
    }
    `;

  const res = await ai.models.generateContent({
    model: 'gemma-3-27b-it',
    tools: [{ google_search_retrieval: {} }],
    contents: [{ role: 'user', parts: [{ text: prompt }] }]
  });

  try {
    return JSON.parse(res.text.trim());
  } catch (e) {
    console.error('JSON parse error:', res.text);
    return null;
  }
}

// ── Send Telegram ───────────────────────────────────────
async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message
    })
  });
}

// ── Main Runner ─────────────────────────────────────────
async function runAIWeatherCheck() {
  const weather = await getWeather('Kuala Lumpur');

  if (!weather) return;

  console.log(weather);

  if (weather) {
    const msg = `
    🌧 Current Weather

    Condition: ${weather.condition}
    Temp: ${weather.temperature}°C
    Humidity: ${weather.humidity}%
    Precip: ${weather.precip_mm}mm
    Rain: ${weather.rain}
    `;

    await sendTelegram(msg);
    console.log('Alert sent');
  } else {
    console.log('No rain');
  }
}

module.exports = { runAIWeatherCheck };