// ── Constants ─────────────────────────────────────────────────────────────
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const WEATHER_API_BASE_URL = process.env.WEATHER_API_BASE_URL;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_BASE_URL = process.env.TELEGRAM_API_BASE_URL;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const DEBUG = process.env.WEATHER_DEBUG_MODE;

// Lark Base (Bitable)
const LARK_APP_ID = process.env.LARK_APP_ID;
const LARK_APP_SECRET = process.env.LARK_APP_SECRET;
const LARK_OPEN_API_BASE_URL = process.env.LARK_OPEN_API_BASE_URL

const BITABLE_APP_TOKEN = process.env.BITABLE_APP_TOKEN;
const BITABLE_TABLE_ID = process.env.BITABLE_TABLE_ID;
const BITABLE_VIEW_ID = process.env.BITABLE_VIEW_ID;
const BITABLE_STATUS_FIELD_NAME = process.env.BITABLE_STATUS_FIELD_NAME;

const RAIN_CODES = new Set([
  1087,
  1150, 1153,
  1180, 1183, 1186, 1189, 1192, 1195,
  1198, 1201,
  1240, 1243, 1246,
  1273, 1276,
]);

// ── Lark Auth ─────────────────────────────────────────────────────────────
async function getTenantAccessToken() {
  if (!LARK_APP_ID || !LARK_APP_SECRET) {
    throw new Error('Missing LARK_APP_ID or LARK_APP_SECRET in environment variables');
  }

  const url = `${LARK_OPEN_API_BASE_URL}/auth/v3/tenant_access_token/internal`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET }),
  });

  const data = await resp.json();
  if (!resp.ok || data.code !== 0) {
    throw new Error(`Lark auth error: ${resp.status} ${resp.statusText} — ${JSON.stringify(data)}`);
  }

  return data.tenant_access_token;
}

async function larkApi(path, { method = 'GET', token, body } = {}) {
  const url = `${LARK_OPEN_API_BASE_URL}${path}`;
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || (typeof data.code === 'number' && data.code !== 0)) {
    throw new Error(`Lark API error: ${resp.status} ${resp.statusText} — ${JSON.stringify(data)}`);
  }
  return data;
}

// ── Lark Base State Helpers ───────────────────────────────────────────────
async function getOrCreateStateRecord(token) {
  if (!BITABLE_APP_TOKEN || !BITABLE_TABLE_ID) {
    throw new Error('Missing BITABLE_APP_TOKEN or BITABLE_TABLE_ID in environment variables');
  }

  // Try to reuse the first row as the singleton state row
  const params = new URLSearchParams({ page_size: '1' });
  if (BITABLE_VIEW_ID) params.set('view_id', BITABLE_VIEW_ID);

  const list = await larkApi(
    `/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${BITABLE_TABLE_ID}/records?${params.toString()}`,
    { token }
  );

  const items = list?.data?.items || [];
  if (items.length > 0) return items[0];

  // No records yet → create one
  const created = await larkApi(
    `/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${BITABLE_TABLE_ID}/records`,
    {
      method: 'POST',
      token,
      body: { fields: { [BITABLE_STATUS_FIELD_NAME]: '' } },
    }
  );

  return created.data.record;
}

async function getLastState() {
  try {
    const token = await getTenantAccessToken();
    const record = await getOrCreateStateRecord(token);
    const raw = record?.fields?.[BITABLE_STATUS_FIELD_NAME];

    // Treat empty string / undefined as “no state”
    const v = (typeof raw === 'string' ? raw.trim() : '') || null;
    return { state: v, record_id: record.record_id }; // state: 'rain'|'clear'|null
  } catch (err) {
    console.error('Lark Base read error:', err.message);
    return { state: null, record_id: null };
  }
}

async function saveState(state, recordId) {
  try {
    const token = await getTenantAccessToken();

    // If we don't have a record yet (unexpected), create/reuse one.
    let record_id = recordId;
    if (!record_id) {
      const record = await getOrCreateStateRecord(token);
      record_id = record.record_id;
    }

    await larkApi(
      `/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${BITABLE_TABLE_ID}/records/${record_id}`,
      {
        method: 'PUT',
        token,
        body: { fields: { [BITABLE_STATUS_FIELD_NAME]: state } },
      }
    );

    console.log('State saved to Lark Base:', state);
  } catch (err) {
    console.error('Lark Base write error:', err.message);
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
    const localtime = weatherData.location.localtime;

    const isRaining = RAIN_CODES.has(conditionCode);

    const { state: lastState, record_id } = await getLastState();

    console.log(`Condition: "${conditionText}" (code: ${conditionCode})`);
    console.log(`isRaining: ${isRaining} | lastState: ${lastState}`);

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

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        condition: conditionText,
        conditionCode,
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