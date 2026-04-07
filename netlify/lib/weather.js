// ── Constants ─────────────────────────────────────────────────────────────
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const WEATHER_API_BASE_URL = process.env.WEATHER_API_BASE_URL;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_BASE_URL = process.env.TELEGRAM_API_BASE_URL;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const DEBUG = process.env.WEATHER_DEBUG_MODE === 'true';

const RAIN_CODES = new Set([
  1063, 1072, 1087, 1150, 1153, 1168, 1171, 1180, 1183, 1186, 1189, 1192, 1195, 1198,
  1201, 1240, 1243, 1246, 1273, 1276,
]);

// ── Helpers ───────────────────────────────────────────────────────────────
function isRainy(conditionCode) {
  return RAIN_CODES.has(conditionCode);
}

function getHourSlot(hours, location, offsetHours) {
  const now = new Date(location.localtime.replace(' ', 'T'));
  const targetHour = (now.getHours() + offsetHours) % 24;
  return (
    hours.find((h) => new Date(h.time.replace(' ', 'T')).getHours() === targetHour) ||
    null
  );
}

function formatSlotDetail(slot, label) {
  return `  ${label}
  ──────────────────
  • Condition    : ${slot.condition.text}
  • Temperature  : ${slot.temp_c}°C / Feels ${slot.feelslike_c}°C
  • Humidity     : ${slot.humidity}%
  • Rainfall     : ${slot.precip_mm} mm
  • Wind         : ${slot.wind_kph} km/h ${slot.wind_dir}
  • Visibility   : ${slot.vis_km} km
  • Pressure     : ${slot.pressure_mb} mb
  • Cloud Cover  : ${slot.cloud}%`;
}

// ── Weather Decision Engine ───────────────────────────────────────────────
function evaluateWeatherConditions(data) {
  const location = data.location;
  const current = data.current;
  const hours = data.forecast.forecastday[0].hour;

  // ── Evaluate states ─────────────────────────────────────────────────────
  const now = new Date(location.localtime.replace(' ', 'T'));
  const next1h = getHourSlot(hours, location, 1);
  const next2h = getHourSlot(hours, location, 2);

  const currentRaining = isRainy(current.condition.code);
  const next1hRaining = next1h ? isRainy(next1h.condition.code) : false;
  const next2hRaining = next2h ? isRainy(next2h.condition.code) : false;

  // ── Debug block ─────────────────────────────────────────────────────────
  const debugLines = DEBUG
    ? `
╔══ 🛠 DEBUG ══╗

  Timestamp    : ${location.localtime}
  Evaluated at : Now=${now.getHours()}:00 | +1hr=${(now.getHours() + 1) % 24}:00 | +2hr=${
        (now.getHours() + 2) % 24
      }:00

  Now
  ──────────────────
  • Code        : ${current.condition.code} (${current.condition.text})
  • Precip      : ${current.precip_mm} mm
  • Rain code?  : ${RAIN_CODES.has(current.condition.code)}
  • isRainy     : ${currentRaining}

  +1 Hour (${next1h ? next1h.time.slice(11, 16) : 'N/A'})
  ──────────────────
  • Code        : ${next1h ? next1h.condition.code : 'N/A'} (${
        next1h ? next1h.condition.text : 'N/A'
      })
  • Precip      : ${next1h ? next1h.precip_mm + ' mm' : 'N/A'}
  • Rain code?  : ${next1h ? RAIN_CODES.has(next1h.condition.code) : 'N/A'}
  • isRainy     : ${next1hRaining}

  +2 Hours (${next2h ? next2h.time.slice(11, 16) : 'N/A'})
  ──────────────────
  • Code        : ${next2h ? next2h.condition.code : 'N/A'} (${
        next2h ? next2h.condition.text : 'N/A'
      })
  • Precip      : ${next2h ? next2h.precip_mm + ' mm' : 'N/A'}
  • Rain code?  : ${next2h ? RAIN_CODES.has(next2h.condition.code) : 'N/A'}
  • isRainy     : ${next2hRaining}

  Decision Table
  ──────────────────
  Now=${currentRaining ? '🌧 rain' : '☀️ clear'} | +1hr=${
        next1hRaining ? '🌧 rain' : '☀️ clear'
      } | +2hr=${next2hRaining ? '🌧 rain' : '☀️ clear'}

  → Rule matched : ${
    !currentRaining && !next1hRaining && !next2hRaining
      ? 'Rule 1 — All clear → return false'
      : currentRaining && !next1hRaining && !next2hRaining
      ? 'Rule 2 — Raining now, clears ahead → active alert'
      : 'Rule 3 — Rain in forecast window → forecast alert'
  }

╚══ END DEBUG ══╝
`
    : '';

  // ── Rule 1: all clear → silent ──────────────────────────────────────────
  if (!currentRaining && !next1hRaining && !next2hRaining) {
    if (DEBUG) return { shouldAlert: false, message: debugLines.trim() };
    return { shouldAlert: false, message: null };
  }

  // ── Shared header ────────────────────────────────────────────────────────
  const windWarn =
    current.wind_kph >= 40
      ? `\n  ⚠️  STRONG WIND: ${current.wind_kph} km/h ${current.wind_dir}`
      : '';

  const header = `╔══ 🌊 CDPS LIGHTNING ALERT ══╗

  📌 ${location.name}, ${location.country}
  🗓️ ${location.localtime}

  Current Conditions
  ──────────────────
  • Condition    : ${current.condition.text}
  • Temperature  : ${current.temp_c}°C / Feels ${current.feelslike_c}°C
  • Humidity     : ${current.humidity}%
  • Rainfall     : ${current.precip_mm} mm
  • Wind         : ${current.wind_kph} km/h ${current.wind_dir}${windWarn}
  • Visibility   : ${current.vis_km} km
  • Pressure     : ${current.pressure_mb} mb
  • Cloud Cover  : ${current.cloud}%`;

  // ── Summary rows ─────────────────────────────────────────────────────────
  const summaryRows = [];
  summaryRows.push(
    `  • Now      → ${current.precip_mm}mm  ${current.condition.text} (${
      current.chance_of_rain ?? '—'
    }%)`
  );
  if (next1h)
    summaryRows.push(
      `  • +1 Hour  → ${next1h.precip_mm}mm  ${next1h.condition.text} (${next1h.chance_of_rain}%)`
    );
  if (next2h)
    summaryRows.push(
      `  • +2 Hours → ${next2h.precip_mm}mm  ${next2h.condition.text} (${next2h.chance_of_rain}%)`
    );

  // ── Rule 2: raining now, clears ahead ────────────────────────────────────
  if (currentRaining && !next1hRaining && !next2hRaining) {
    const message = `${header}

  🚨 RAIN ALERT — ACTIVE NOW
  ──────────────────
  • Status       : RAINING NOW
  • Clearing     : Expected within 1–2 hours

  Hour-by-Hour Summary
  ──────────────────
${summaryRows.join('\n')}

  Advisory
  ──────────────────
  • All outdoor site and marine works activities are to cease immediately, Please make your way to the nearest lightning shelter thank you
${debugLines}
╚══ Updated: ${current.last_updated} ══╝`;

    return { shouldAlert: true, message };
  }

  // ── Rule 3: rain in forecast window ──────────────────────────────────────
  let etaLabel = '';
  if (!currentRaining && next1hRaining) etaLabel = '~1 hour';
  else if (!currentRaining && !next1hRaining && next2hRaining) etaLabel = '~2 hours';

  const alertType = currentRaining
    ? '🚨 RAIN ALERT — ACTIVE + FORECAST'
    : `⚠️  INCOMING RAIN — ETA ${etaLabel}`;

  const slotDetails = [];
  if (next1h && next1hRaining)
    slotDetails.push(
      formatSlotDetail(next1h, `📍 Forecast +1 Hour (${next1h.time.slice(11, 16)})`)
    );
  if (next2h && next2hRaining)
    slotDetails.push(
      formatSlotDetail(next2h, `📍 Forecast +2 Hours (${next2h.time.slice(11, 16)})`)
    );

  const message = `${header}

  ${alertType}

  Hour-by-Hour Summary
  ──────────────────
${summaryRows.join('\n')}
${slotDetails.length > 0 ? '\n' + slotDetails.join('\n\n') : ''}

  Advisory
  ──────────────────
  ${currentRaining ? '• Ongoing rain — stay alert' : `• Prepare for rain in ${etaLabel}`}
  • All outdoor site and marine works activities are to cease immediately, Please make your way to the nearest lightning shelter thank you
${debugLines}
╚══ Updated: ${current.last_updated} ══╝`;

  return { shouldAlert: true, message };
}

// ── Fetch Weather Data ───────────────────────────────────────────────────
async function fetchWeatherData(latitude, longitude) {
  try {
    const url = `${WEATHER_API_BASE_URL}/forecast.json?key=${WEATHER_API_KEY}&q=${latitude},${longitude}&aqi=no&alerts=no`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching weather data:', error.message);
    throw error;
  }
}

// ── Send Telegram Notification ───────────────────────────────────────────
async function sendTelegramAlert(message) {
  try {
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
      throw new Error(`Telegram API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    console.log('Telegram alert sent successfully:', result.ok);
    return result;
  } catch (error) {
    console.error('Error sending Telegram alert:', error.message);
    throw error;
  }
}

// ── Main Weather Check Logic ───────────────────────────────────────────────
async function runWeatherCheck() {
  try {
    // Get configuration from environment or use defaults
    const latitude = process.env.LOCATION_LATITUDE;
    const longitude = process.env.LOCATION_LONGITUDE;
    const locationName = process.env.LOCATION_NAME;

    // Fetch weather data
    console.log(
      `📍 Fetching weather for ${locationName} (${latitude}, ${longitude})`
    );
    const weatherData = await fetchWeatherData(latitude, longitude);

    // Evaluate weather conditions and determine if alert should be sent
    const { shouldAlert, message } = evaluateWeatherConditions(weatherData);

    if (shouldAlert && message) {
      console.log('🚨 Alert condition detected, sending Telegram notification');
      await sendTelegramAlert(message);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Weather alert sent successfully',
          alertType: 'weather_notification',
          timestamp: new Date().toISOString(),
        }),
      };
    } else {
      console.log('✅ No alert needed - conditions are clear');
      if (DEBUG && message) {
        console.log('📊 Debug info:\n', message);
      }
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'No alert needed - conditions are clear',
          alertType: 'no_alert',
          timestamp: new Date().toISOString(),
          debug: DEBUG ? message : undefined,
        }),
      };
    }
  } catch (error) {
    console.error('❌ Error in weather check:', error.message);
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

// ── Export the main function ────────────────────────────────────────────────
module.exports = { runWeatherCheck };
