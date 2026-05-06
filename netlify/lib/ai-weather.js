const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

// ── Define models once ─────────────────────────────────────────────────────
const searchModel = genAI.getGenerativeModel({ 
  model: 'gemini-3.1-flash-lite',
  tools: [{ googleSearch: {} }]
});

const formatModel = genAI.getGenerativeModel({ model: 'gemma-3-27b-it' });

// ── Simple in-memory lock to prevent concurrent runs ──────────────────────
let isRunning = false;
let lastRunAt = 0;
const MIN_INTERVAL_MS = 60_000;

// ── Fetch and format weather ───────────────────────────────────────────────
async function fetchAndFormatWeather(location, now) {
  try {
    // Step 1: Fetch with 500 RPD Gemini 3.1 Flash Lite
    const searchPrompt = `Search Google Weather for the current weather in ${location} as of ${now} MYT. 
    Return ONLY raw facts: condition, temp °C, humidity %, rainfall mm, and if it is raining.`;

    const searchResult = await searchModel.generateContent(searchPrompt);
    const rawWeather = searchResult.response.text();

    // Step 2: Format with 14.4K RPD Gemma 3
    const formatPrompt = `
      Format this data into a plain-text Telegram message.
      Use this EXACT format (no markdown, no backticks, no extra text):

      🌤 Weather Update — ${location}
      🕐 ${now} MYT

      Condition : [condition]
      Temperature: [number]°C
      Humidity   : [number]%
      Rainfall   : [number] mm
      Raining now: [Yes / No]

      📡 Source: Google Weather

      Data: ${rawWeather}`;

    const formatResult = await formatModel.generateContent(formatPrompt);
    return formatResult.response.text().trim();
  } catch (e) {
    console.error("Model Error:", e.message);
    throw e;
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────
async function getWeather(location) {
  const now = new Date().toLocaleString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    dateStyle: 'full',
    timeStyle: 'short'
  });

  const message = await fetchAndFormatWeather(location, now);
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
  const now = Date.now();

  if (isRunning) {
    console.log('Already running, skipping this invocation');
    return;
  }

  if (now - lastRunAt < MIN_INTERVAL_MS) {
    console.log(`Too soon since last run (${Math.round((now - lastRunAt) / 1000)}s ago), skipping`);
    return;
  }

  isRunning = true;
  lastRunAt = now;

  try {
    const message = await getWeather('Subang Jaya');
    console.log('Sending:\n', message);
    await sendTelegram(message);
    console.log('Alert sent');
  } catch (err) {
    console.error('Weather check failed:', JSON.stringify({ error: err }));

    if (err?.message?.includes('429') || err?.status === 429) {
      console.error('Gemini free tier quota exhausted. Resets daily at midnight PT.');
    }
  } finally {
    isRunning = false;
  }
}

module.exports = { runAIWeatherCheck };