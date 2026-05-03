// ── Constants ─────────────────────────────────────────────────────────────
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const WEATHER_API_BASE_URL = process.env.WEATHER_API_BASE_URL;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_BASE_URL = process.env.TELEGRAM_API_BASE_URL;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const DEBUG = process.env.WEATHER_DEBUG_MODE === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const WEATHER_STATUS_TABLE = process.env.WEATHER_STATUS_TABLE;

const DEFINITIVE_RAIN_CODES = [1153,1168,1171,1183,1186,1189,1192,1195,1198,1201,1204,1207,1240,1243,1246,1249,1252,1273,1276];

// ── Supabase Client ───────────────────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js');

function getSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment variables');
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// ── Error Logging ─────────────────────────────────────────────────────────
// error_type: 'weather_api' | 'forecast_api' | 'telegram' | 'supabase' | 'unhandled'
async function logError(errorType, errorMsg) {
  try {
    const supabase = getSupabaseClient();
    await supabase
      .from('error_logs')
      .insert({ error_type: errorType, error_msg: errorMsg });
  } catch (err) {
    console.warn('Failed to write to error_logs:', err.message);
  }
}

// ── Supabase Weather Logging ──────────────────────────────────────────────
async function logWeatherCheckToSupabase({
  conditionCode,
  conditionText,
  precipMm,
  humidity,
  isRaining,
  hasDefinitiveCode,
  triggeredBy,
  matchedHour,
  willItRain,
  chanceOfRain,
  forecastPrecipMm,
  forecastPrecipHigh,
  lastState,
  alertSent,
  localtime,
}) {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('weather_logs')
      .insert({
        timestamp:             localtime,
        condition_code:        conditionCode,
        condition_text:        conditionText,
        precip_mm:             precipMm,
        humidity:              humidity,
        is_raining:            isRaining,
        has_definitive_code:   hasDefinitiveCode,
        triggered_by:          triggeredBy,
        matched_hour:          matchedHour,
        will_it_rain:          willItRain,
        chance_of_rain:        chanceOfRain,
        forecast_precip_mm:    forecastPrecipMm,
        forecast_precip_high:  forecastPrecipHigh,
        last_state:            lastState,
        alert_sent:            alertSent,
      });

    if (error) {
      console.warn('weather_logs insert warning:', error.message);
    }
  } catch (err) {
    console.warn('Failed to log weather check:', err.message);
  }
}

// ── Supabase State Helpers ────────────────────────────────────────────────
async function getOrCreateStateRecord() {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from(WEATHER_STATUS_TABLE)
    .select('*')
    .limit(1);

  if (error) {
    throw new Error(`Supabase read error: ${error.message}`);
  }

  if (data && data.length > 0) {
    return data[0];
  }

  const { data: created, error: createError } = await supabase
    .from(WEATHER_STATUS_TABLE)
    .insert({ weather_status: '' })
    .select()
    .single();

  if (createError) {
    throw new Error(`Supabase insert error: ${createError.message}`);
  }

  return created;
}

async function getLastState() {
  try {
    const record = await getOrCreateStateRecord();
    const raw = record?.weather_status;
    const v = (typeof raw === 'string' ? raw.trim() : '') || null;
    return { state: v, record_id: record.id };
  } catch (err) {
    console.error('Supabase read error:', err.message);
    return { state: null, record_id: null };
  }
}

async function saveState(state, recordId) {
  try {
    const supabase = getSupabaseClient();

    let record_id = recordId;
    if (!record_id) {
      const record = await getOrCreateStateRecord();
      record_id = record.id;
    }

    const { error } = await supabase
      .from(WEATHER_STATUS_TABLE)
      .update({ weather_status: state })
      .eq('id', record_id);

    if (error) {
      throw new Error(`Supabase update error: ${error.message}`);
    }

    console.log('State saved to Supabase:', state);
  } catch (err) {
    console.error('Supabase write error:', err.message);
  }
}

// ── Date Formatter ────────────────────────────────────────────────────────
function formatLocalTime(localtime) {
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

// ── Fetch Forecast Data ───────────────────────────────────────────────────
async function fetchForecastData(latitude, longitude) {
  if (!WEATHER_API_KEY || !WEATHER_API_BASE_URL) {
    throw new Error('Missing WEATHER_API_KEY or WEATHER_API_BASE_URL');
  }

  const url = `${WEATHER_API_BASE_URL}/forecast.json?key=${WEATHER_API_KEY}&q=${latitude},${longitude}&days=1&aqi=no&alerts=no`;
  console.log('Forecast API request: /forecast.json?days=1');

  const response = await fetch(url);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Forecast API error: ${response.status} ${response.statusText} — ${errorText}`);
  }

  return response.json();
}

// ── Forecast Hour Matcher ─────────────────────────────────────────────────
// Rounds localtime to the nearest hour. Cron fires every 15 min so at :45
// we round UP to the next hour. With a 1-day fetch there is no next-day slot,
// so 23:45 falls back to 23:00 rather than rolling to 00:00.
function getMatchedForecastHour(forecastData, localtime) {
  const [datePart, timePart] = localtime.split(' ');
  const [h, m] = timePart.split(':').map(Number);

  let roundedHour = m >= 30 ? h + 1 : h;

  if (roundedHour === 24) {
    roundedHour = 23; // 1-day fetch has no next-day slot, use last available
  }

  const paddedHour = String(roundedHour).padStart(2, '0');
  const targetTime = `${datePart} ${paddedHour}:00`;

  const hours = forecastData?.forecast?.forecastday?.[0]?.hour || [];
  const slot = hours.find(slot => slot.time === targetTime); // 'slot' avoids shadowing outer 'h'

  if (!slot) {
    console.warn(`No forecast slot found for ${targetTime}`);
    return null;
  }

  return slot;
}

// ── Rain Detection ────────────────────────────────────────────────────────
function detectRain(conditionCode, precipMm, forecastSlot) {
  const hasDefinitiveCode = DEFINITIVE_RAIN_CODES.includes(conditionCode);

  let forecastSaysRaining = false;
  let forecastPrecipHigh  = false;

  if (forecastSlot) {
    forecastSaysRaining = forecastSlot.will_it_rain === 1
      && forecastSlot.chance_of_rain >= 70;

    // Intentionally using forecastSlot.precip_mm (per-hour estimate),
    // NOT current.precip_mm which is a stale rolling accumulator
    forecastPrecipHigh = forecastSlot.precip_mm >= 1.0;
  }

  let isRaining   = false;
  let triggeredBy = 'none';

  if (hasDefinitiveCode) {
    if (forecastSaysRaining) {
      isRaining   = true;
      triggeredBy = 'code+forecast';
    } else if (precipMm >= 2.0) {
      // High precip floor — above the stale-accumulation zone (1.83mm in logs)
      isRaining   = true;
      triggeredBy = 'code+precip';
    }
  } else {
    // No definitive code — require both forecast and precip to agree
    if (forecastSaysRaining && forecastPrecipHigh) {
      isRaining   = true;
      triggeredBy = 'forecast+precip';
    }
  }

  if (!forecastSlot && !hasDefinitiveCode) {
    console.warn('detectRain: no forecast slot and no definitive code — defaulting to not raining');
  }

  if (DEBUG) {
    console.log('Rain detection:');
    console.log(`  hasDefinitiveCode: ${hasDefinitiveCode} (code: ${conditionCode})`);
    console.log(`  forecastSaysRaining: ${forecastSaysRaining}`);
    console.log(`  forecastPrecipHigh: ${forecastPrecipHigh} (slot precip: ${forecastSlot?.precip_mm ?? 'N/A'}mm)`);
    console.log(`  current precip: ${precipMm}mm`);
    console.log(`  isRaining: ${isRaining} | triggeredBy: ${triggeredBy}`);
  }

  return { isRaining, triggeredBy, hasDefinitiveCode, forecastSaysRaining, forecastPrecipHigh };
}

// ── Send Telegram Alert ───────────────────────────────────────────────────
async function sendTelegramAlert(message) {
  if (DEBUG) {
    console.log('DEBUG MODE: Skipping Telegram alert');
    return { ok: true, debug: true };
  }

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_API_BASE_URL || !TELEGRAM_CHAT_ID) {
    throw new Error('Missing Telegram credentials in environment variables');
  }

  const url = `${TELEGRAM_API_BASE_URL}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id:    TELEGRAM_CHAT_ID,
    text:       message,
    parse_mode: 'HTML',
  };

  const response = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
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
    const latitude     = process.env.LOCATION_LATITUDE;
    const longitude    = process.env.LOCATION_LONGITUDE;
    const locationName = process.env.LOCATION_NAME;

    console.log(`Checking weather for ${locationName} (${latitude}, ${longitude})`);
    if (DEBUG) console.log('DEBUG MODE ENABLED');

    // ── 1. Fetch current conditions ──────────────────────────────────────
    const weatherData = await fetchWeatherData(latitude, longitude);

    const conditionCode = weatherData.current.condition.code;
    const conditionText = weatherData.current.condition.text;
    const precipMm      = weatherData.current.precip_mm || 0;
    const humidity      = weatherData.current.humidity || 0;
    const localtime     = weatherData.location.localtime;

    console.log(`Condition: "${conditionText}" (code: ${conditionCode})`);
    console.log(`Precipitation: ${precipMm}mm | Humidity: ${humidity}%`);

    // ── 2. Fetch forecast (separate call, non-fatal on failure) ──────────
    let forecastSlot = null;
    let matchedHour  = null;

    try {
      const forecastData = await fetchForecastData(latitude, longitude);
      forecastSlot       = getMatchedForecastHour(forecastData, localtime);
      matchedHour        = forecastSlot?.time?.split(' ')[1] || null;
      console.log(`Matched forecast hour: ${matchedHour ?? 'none'}`);
    } catch (forecastErr) {
      console.warn('Forecast fetch failed — proceeding without corroboration:', forecastErr.message);
      await logError('forecast_api', forecastErr.message);
      // forecastSlot stays null — detectRain handles this gracefully
    }

    // ── 3. Detect rain ───────────────────────────────────────────────────
    const {
      isRaining,
      triggeredBy,
      hasDefinitiveCode,
      forecastSaysRaining,
      forecastPrecipHigh,
    } = detectRain(conditionCode, precipMm, forecastSlot);

    console.log(`isRaining: ${isRaining} | triggeredBy: ${triggeredBy}`);

    // ── 4. Load state ────────────────────────────────────────────────────
    const { state: lastState, record_id } = await getLastState();
    console.log(`lastState: ${lastState}`);

    // ── 5. Transition logic ──────────────────────────────────────────────
    let action    = '';
    let alertSent = false;

    if (!lastState) {
      if (isRaining) {
        await sendTelegramAlert(buildDetectedMessage(localtime));
        await saveState('rain', record_id);
        action    = 'DETECTED alert sent (no prior state)';
        alertSent = true;
      } else {
        action = 'No state + clear, skipped';
      }
    } else if (lastState === 'rain') {
      if (!isRaining) {
        await sendTelegramAlert(buildClearedMessage(localtime));
        await saveState('clear', record_id);
        action    = 'CLEARED alert sent';
        alertSent = true;
      } else {
        action = 'Still raining, skipped';
      }
    } else if (lastState === 'clear') {
      if (isRaining) {
        await sendTelegramAlert(buildDetectedMessage(localtime));
        await saveState('rain', record_id);
        action    = 'Raining again, DETECTED sent';
        alertSent = true;
      } else {
        action = 'Still clear, skipped';
      }
    } else {
      action = `Unknown lastState="${lastState}", treating as no state`;
      if (isRaining) {
        await sendTelegramAlert(buildDetectedMessage(localtime));
        await saveState('rain', record_id);
        alertSent = true;
      }
    }

    console.log(`Action: ${action}`);

    // ── 6. Log every run ─────────────────────────────────────────────────
    await logWeatherCheckToSupabase({
      conditionCode,
      conditionText,
      precipMm,
      humidity,
      isRaining,
      hasDefinitiveCode,
      triggeredBy,
      matchedHour,
      willItRain:        forecastSlot ? forecastSlot.will_it_rain === 1 : null,
      chanceOfRain:      forecastSlot?.chance_of_rain ?? null,
      forecastPrecipMm:  forecastSlot?.precip_mm ?? null,
      forecastPrecipHigh,
      lastState,
      alertSent,
      localtime,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success:      true,
        condition:    conditionText,
        conditionCode,
        precipMm,
        humidity,
        isRaining,
        triggeredBy,
        matchedHour,
        lastState,
        action,
        alertSent,
        debug:        DEBUG,
        timestamp:    new Date().toISOString(),
      }),
    };

  } catch (error) {
    console.error('Fatal error in runWeatherCheck:', error.message);
    await logError('unhandled', error.message).catch(() => {});
    return {
      statusCode: 500,
      body: JSON.stringify({
        success:   false,
        error:     error.message,
        debug:     DEBUG,
        timestamp: new Date().toISOString(),
      }),
    };
  }
}

module.exports = { runWeatherCheck };