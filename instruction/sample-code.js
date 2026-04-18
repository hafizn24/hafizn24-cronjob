function handler(input) {
  const DEBUG = true;

  const data = input.json_map || input;
  const location = data.location;
  const current = data.current;
  const hours = data.forecast.forecastday[0].hour;

  // ── Rain condition codes ──────────────────────────────────────────────────
  const RAIN_CODES = new Set([
    1063, 1072, 1087, 1150, 1153, 1168, 1171, 1180, 1183, 1186, 1189, 1192, 1195, 1198,
    1201, 1240, 1243, 1246, 1273, 1276,
  ]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function isRainy(conditionCode) {
    return RAIN_CODES.has(conditionCode);
  }

  function getHourSlot(offsetHours) {
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

  // ── Evaluate states ───────────────────────────────────────────────────────
  const now = new Date(location.localtime.replace(' ', 'T'));
  const next1h = getHourSlot(1);
  const next2h = getHourSlot(2);

  const currentRaining = isRainy(current.condition.code);
  const next1hRaining = next1h ? isRainy(next1h.condition.code) : false;
  const next2hRaining = next2h ? isRainy(next2h.condition.code) : false;

  // ── Debug block ───────────────────────────────────────────────────────────
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

  // ── Rule 1: all clear → silent ────────────────────────────────────────────
  if (!currentRaining && !next1hRaining && !next2hRaining) {
    if (DEBUG) return debugLines.trim();
    return false;
  }

  // ── Shared header ─────────────────────────────────────────────────────────
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

  // ── Summary rows ──────────────────────────────────────────────────────────
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
    return `${header}

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

  return `${header}

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
}