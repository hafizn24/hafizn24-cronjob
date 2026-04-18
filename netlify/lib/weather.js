// ── Imports ───────────────────────────────────────────────────────────────
const { getStore } = require('@netlify/blobs');

// ── Constants ─────────────────────────────────────────────────────────────
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const WEATHER_API_BASE_URL = process.env.WEATHER_API_BASE_URL;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_BASE_URL = process.env.TELEGRAM_API_BASE_URL;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const BLOB_STORE_NAME = 'weather-state';
const BLOB_KEY = 'alert-state';

const RAIN_CODES = new Set([
  1087,                               // Thundery outbreaks nearby
  1150, 1153,                         // Drizzle
  1180, 1183, 1186, 1189, 1192, 1195, // Rain light to heavy
  1198, 1201,                         // Freezing rain
  1240, 1243, 1246,                   // Rain showers
  1273, 1276,                         // Rain with thunder
]);

// ── Blob State Helpers ────────────────────────────────────────────────────
async function getLastState() {
  try {
    const store = getStore(BLOB_STORE_NAME);
    const value = await store.get(BLOB_KEY);
    return value ?? null; // 'rain' | 'clear' | null
  } catch (err) {
    console.error('Blob read error:', err.message);
    return null;
  }
}

async function saveState(state) {
  try {
    const store = getStore(BLOB_STORE_NAME);
    await store.set(BLOB_KEY, state);
    console.log('State saved:', state);
  } catch (err) {
    console.error('Blob write error:', err.message);
  }
}

// ── Date Formatter ────────────────────────────────────────────────────────
function formatLocalTime(localtime) {
  // API returns localtime as "2026-04-11 08:24"
  const [datePart, timePart] = localtime.split(' ');
  const [year, month, day] = datePart.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthName = months[parseInt(month, 10) - 1];
  return { date: `${day}-${monthName}-${year}`, time: timePart };
}

// ── Message Builders ──────────────────────────────────────────────────────
function buildDetectedMessage(localtime) {
  const { date, time } = formatLocalTime(localtime);
  return (
    `⚡⚡⚡ LIGHTNING ALERT DETECTED ⚡⚡⚡\n\n` +
    `Lightning has been detected within our vicinity.\n\n` +
    `All open field & exposed work activities are to CEASE IMMEDIATELY and proceed to the nearest lightning shelter.\n\n` +
    `📅 Date: ${date}\n` +
    `🕐 Time: ${time}`
  );
}

function buildClearedMessage(localtime) {
  const { date, time } = formatLocalTime(localtime);
  return (
    `☀️☀️☀️ LIGHTNING ALERT CLEARED ☀️☀️☀️\n\n` +
    `Lightning alert has been cleared.\n\n` +
    `All personnel involved in open field & exposed work activities may now RESUME work.\n\n` +
    `📅 Date: ${date}\n` +
    `🕐 Time: ${time}`
  );
}

// ── Fetch Weather Data ────────────────────────────────────────────────────
async function fetchWeatherData(latitude, longitude) {
  if (!latitude || !longitude) {
    throw new Error(`Invalid coordinates: latitude=${latitude}, longitude=${longitude}`);
  }
  if (!WEATHER_API_KEY || !WEATHER_API_BASE_URL) {
    throw new Error('Missing WEATHER_API_KEY or WEATHER_API_BASE_URL in environment variables');
  }

  const url = `${WEATHER_API_BASE_URL}/current.json?key=${WEATHER_API_KEY}&q=${latitude},${longitude}&aqi=no`;
  console.log(`Weather API request: /current.json?q=${latitude},${longitude}`);

  const response = await fetch(url);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Weather API error: ${response.status} ${response.statusText} — ${errorText}`);
  }

  return response.json();
}

// ── Send Telegram Alert ───────────────────────────────────────────────────
async function sendTelegramAlert(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_API_BASE_URL || !TELEGRAM_CHAT_ID) {
    throw new Error('Missing Telegram credentials in environment variables');
  }

  const url = `${TELEGRAM_API_BASE_URL}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: 'HTML',
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Telegram API error: ${response.status} ${response.statusText} — ${errorText}`);
  }

  const result = await response.json();
  console.log('Telegram alert sent:', result.ok);
  return result;
}

// ── Main Weather Check ────────────────────────────────────────────────────
async function runWeatherCheck() {
  try {
    const latitude = process.env.LOCATION_LATITUDE;
    const longitude = process.env.LOCATION_LONGITUDE;
    const locationName = process.env.LOCATION_NAME;

    console.log(`Checking weather for ${locationName} (${latitude}, ${longitude})`);

    const weatherData = await fetchWeatherData(latitude, longitude);
    const conditionCode = weatherData.current.condition.code;
    const conditionText = weatherData.current.condition.text;
    const localtime = weatherData.location.localtime;
    const isRaining = RAIN_CODES.has(conditionCode);
    const lastState = await getLastState();

    console.log(`Condition: "${conditionText}" (code: ${conditionCode})`);
    console.log(`isRaining: ${isRaining} | lastState: ${lastState}`);

    if (isRaining && lastState !== 'rain') {
      // Transition to rain — send DETECTED
      await sendTelegramAlert(buildDetectedMessage(localtime));
      await saveState('rain');
      console.log('Action: DETECTED alert sent');

    } else if (!isRaining && lastState === 'rain') {
      // Transition to clear after rain — send CLEARED
      await sendTelegramAlert(buildClearedMessage(localtime));
      await saveState('clear');
      console.log('Action: CLEARED alert sent');

    } else {
      // No state change
      console.log('Action: No change, skipped');
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        condition: conditionText,
        conditionCode,
        isRaining,
        lastState,
        timestamp: new Date().toISOString(),
      }),
    };

  } catch (error) {
    console.error('Error in runWeatherCheck:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
    };
  }
}

// ── Export ────────────────────────────────────────────────────────────────
module.exports = { runWeatherCheck };
