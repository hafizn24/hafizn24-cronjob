// ── Constants ─────────────────────────────────────────────────────────────
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const WEATHER_API_BASE_URL = process.env.WEATHER_API_BASE_URL;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_BASE_URL = process.env.TELEGRAM_API_BASE_URL;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const DEBUG = process.env.WEATHER_DEBUG_MODE === 'true';

// Supabase Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const WEATHER_STATUS_TABLE = process.env.WEATHER_STATUS_TABLE;

// ── Rain Detection Thresholds ─────────────────────────────────────────────
// Any 2 of 3 conditions = isRaining true
const RAIN_PRECIP_MM_THRESHOLD  = 0.1;  // precip_mm > 0.1
const RAIN_HUMIDITY_THRESHOLD   = 85;   // humidity > 85%
const RAIN_DEWPOINT_SPREAD_MAX  = 2;    // (temp_c - dewpoint_c) < 2°C

// ── Supabase Client ──────────────────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js');

function getSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment variables');
  }

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// ── Supabase Logging ────────────────────────────────────────────────────
async function logWeatherCheckToSupabase(conditionCode, precipMm, isRaining, lastState, alertSent, localtime, humidity, dewpointSpread) {
  try {
    const supabase = getSupabaseClient();
    const logsTable = 'weather_logs';

    const { error } = await supabase
      .from(logsTable)
      .insert({
        condition_code: conditionCode,
        precip_mm: precipMm,
        is_raining: isRaining,
        last_state: lastState,
        alert_sent: alertSent,
        timestamp: localtime,
        humidity: humidity,
        dewpoint: dewpointSpread,
      });

    if (error) {
      console.warn(`Supabase log insert warning: ${error.message}`);
    }
  } catch (err) {
    console.warn('Failed to log weather check to Supabase:', err.message);
  }
}

// ── Supabase State Helpers ───────────────────────────────────────────────
async function getOrCreateStateRecord() {
  const supabase = getSupabaseClient();

  // Try to fetch the first record from weather_status table
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

  // No records yet → create one
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

    // Treat empty string / undefined as "no state"
    const v = (typeof raw === 'string' ? raw.trim() : '') || null;
    return { state: v, record_id: record.id }; // state: 'rain'|'clear'|null
  } catch (err) {
    console.error('Supabase read error:', err.message);
    return { state: null, record_id: null };
  }
}

async function saveState(state, recordId) {
  try {
    const supabase = getSupabaseClient();

    // If we don't have a record yet (unexpected), create/reuse one.
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
    if (DEBUG) console.log('DEBUG MODE ENABLED');

    const weatherData = await fetchWeatherData(latitude, longitude);
    const conditionCode = weatherData.current.condition.code;
    const conditionText = weatherData.current.condition.text;
    const precipMm = weatherData.current.precip_mm || 0;
    const humidity = weatherData.current.humidity || 0;
    const tempC = weatherData.current.temp_c || 0;
    const dewpointC = weatherData.current.dewpoint_c || 0;
    const dewpointSpread = parseFloat((tempC - dewpointC).toFixed(2));
    const localtime = weatherData.location.localtime;

    // ── Rain confidence: any 2 of 3 conditions = isRaining ──────────────
    const condPrecip   = precipMm > RAIN_PRECIP_MM_THRESHOLD;
    const condHumidity = humidity > RAIN_HUMIDITY_THRESHOLD;
    const condDewpoint = dewpointSpread < RAIN_DEWPOINT_SPREAD_MAX;
    const conditionsMet = [condPrecip, condHumidity, condDewpoint].filter(Boolean).length;
    const isRaining = conditionsMet >= 2;

    if (DEBUG) {
      console.log(`Rain conditions — precip: ${condPrecip} (${precipMm}mm), humidity: ${condHumidity} (${humidity}%), dewpoint spread: ${condDewpoint} (${dewpointSpread}°C) → ${conditionsMet}/3 met`);
    }

    const { state: lastState, record_id } = await getLastState();

    console.log(`Condition: "${conditionText}" (code: ${conditionCode})`);
    console.log(`Precipitation: ${precipMm}mm | Humidity: ${humidity}% | Dewpoint spread: ${dewpointSpread}°C`);
    console.log(`isRaining: ${isRaining} (${conditionsMet}/3 conditions met) | lastState: ${lastState}`);

    // ── Transition rules ────────────────────────────────────────────────
    // No state
    //   → raining? → set 'rain', send DETECTED
    //   → clear?   → do nothing
    // 'rain'
    //   → still raining? → do nothing
    //   → cleared?       → set 'clear', send CLEARED
    // 'clear'
    //   → still clear?   → do nothing
    //   → raining again? → set 'rain', send DETECTED

    let action = '';
    let alertSent = false;

    if (!lastState) {
      if (isRaining) {
        await sendTelegramAlert(buildDetectedMessage(localtime));
        await saveState('rain', record_id);
        action = 'DETECTED alert sent';
        alertSent = true;
      } else {
        action = 'No state + clear, skipped';
      }
    } else if (lastState === 'rain') {
      if (!isRaining) {
        await sendTelegramAlert(buildClearedMessage(localtime));
        await saveState('clear', record_id);
        action = 'CLEARED alert sent';
        alertSent = true;
      } else {
        action = 'Still raining, skipped';
      }
    } else if (lastState === 'clear') {
      if (isRaining) {
        await sendTelegramAlert(buildDetectedMessage(localtime));
        await saveState('rain', record_id);
        action = 'Raining again, DETECTED sent';
        alertSent = true;
      } else {
        action = 'Still clear, skipped';
      }
    } else {
      // Unknown value in Base → treat as no state
      action = `Unknown lastState="${lastState}"; treating as no state`;
      if (isRaining) {
        await sendTelegramAlert(buildDetectedMessage(localtime));
        await saveState('rain', record_id);
        alertSent = true;
      }
    }

    console.log(`Action: ${action}`);

    // Log every cron run to Supabase
    await logWeatherCheckToSupabase(conditionCode, precipMm, isRaining, lastState, alertSent, localtime, humidity, dewpointSpread);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        condition: conditionText,
        conditionCode,
        precipMm,
        humidity,
        dewpointSpread,
        conditionsMet,
        isRaining,
        lastState,
        action,
        alertSent,
        debug: DEBUG,
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
        debug: DEBUG,
        timestamp: new Date().toISOString(),
      }),
    };
  }
}

module.exports = { runWeatherCheck };