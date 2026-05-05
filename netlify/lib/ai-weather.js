const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

// ── Get Weather from Gemini (Grounded) ──────────────────
async function getWeather(location = 'Subang Jaya') {

  const prompt = `
    You are a weather reporter. Using Google Search, get the current weather for ${location}.

    Return ONLY a plain-text Telegram message in this exact format (no markdown, no backticks):

    🌤 Weather Update — ${location}
    🕐 [date-time]

    Condition : [e.g. Partly Cloudy]
    Temperature: [number]°C
    Humidity   : [number]%
    Rainfall   : [number] mm
    Raining now: [Yes / No]

    📡 Source: [one source name, e.g. Weather.com or AccuWeather]

    Do not add anything else. No explanations. No code.
    `;

  const res = await ai.models.generateContent({
    model: 'gemma-3-27b-it',
    tools: [{ googleSearch: {} }],
    contents: [{ role: 'user', parts: [{ text: prompt }] }]
  });

  const text = res.text?.trim();
  if (!text) throw new Error('Empty response from Gemini');
  return text;
}

// ── Send Telegram ───────────────────────────────────────
async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram error: ${err}`);
  }
}

// ── Main Runner ─────────────────────────────────────────
async function runAIWeatherCheck() {
  try {
    const message = await getWeather('Kuala Lumpur');
    console.log('Sending:\n', message);
    await sendTelegram(message);
    console.log('Alert sent');
  } catch (err) {
    console.error('Weather check failed:', err.message);
  }
}

module.exports = { runAIWeatherCheck };