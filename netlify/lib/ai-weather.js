const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

// ── Step 1: Fetch raw weather via Gemini 2.5 Flash (search grounding) ──
async function fetchRawWeather(location, now) {
  const response = await ai.models.generateContentStream({
    model: 'gemini-2.5-flash',
    contents: [{
      role: 'user',
      parts: [{ text: `Get the current weather for ${location} as of ${now} MYT. Return raw facts only: condition, temperature °C, humidity %, rainfall mm, is it raining now, and the source name. No formatting.` }]
    }],
    config: {
      tools: [{ googleSearch: {} }],
    }
  });

  let raw = '';
  for await (const chunk of response) raw += chunk.text ?? '';
  if (!raw.trim()) throw new Error('Empty response from Gemini');
  return raw.trim();
}

// ── Step 2: Format message via Gemma 3 27B (no search, free) ────────────
async function formatWeatherMessage(rawWeather, location, now) {
  const response = await ai.models.generateContentStream({
    model: 'gemma-3-27b-it',
    contents: [{
      role: 'user',
      parts: [{ text: `
        Format the weather data below into a plain-text Telegram message.
        Use this EXACT format (no markdown, no backticks, no extra text):

        🌤 Weather Update — ${location}
        🕐 ${now} MYT

        Condition : [condition]
        Temperature: [number]°C
        Humidity   : [number]%
        Rainfall   : [number] mm
        Raining now: [Yes / No]

        📡 Source: [source]

        Weather data:
        ${rawWeather}
      `}]
    }],
  });

  let message = '';
  for await (const chunk of response) message += chunk.text ?? '';
  if (!message.trim()) throw new Error('Empty response from Gemma');
  return message.trim();
}

// ── Orchestrator ─────────────────────────────────────────────────────────
async function getWeather(location) {
  const now = new Date().toLocaleString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    dateStyle: 'full',
    timeStyle: 'short'
  });

  const rawWeather = await fetchRawWeather(location, now);
  const message    = await formatWeatherMessage(rawWeather, location, now);
  return message;
}

// ── Send Telegram ─────────────────────────────────────────────────────────
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

// ── Main Runner ───────────────────────────────────────────────────────────
async function runAIWeatherCheck() {
  try {
    const message = await getWeather('Subang Jaya');
    console.log('Sending:\n', message);
    await sendTelegram(message);
    console.log('Alert sent');
  } catch (err) {
    console.error('Weather check failed:', err.message);
  }
}

module.exports = { runAIWeatherCheck };