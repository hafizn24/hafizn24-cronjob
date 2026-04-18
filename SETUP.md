# Weather Report Scheduling Endpoint - Netlify Cron Job

A serverless scheduled function that monitors weather conditions and sends automated alerts via Telegram for outdoor marine activities.

## 📋 Project Structure

```
hafizn24-cronjob/
├── netlify/
│   └── functions/
│       └── weather-cron.js          # Main cron job handler
├── netlify.toml                      # Netlify configuration & schedule
├── package.json                      # Project dependencies
├── .env.example                      # Environment variables template
└── README.md                         # This file
```

## 🚀 Quick Start

### Prerequisites

- Node.js v14+ and npm
- Netlify account
- Weather API key from [WeatherAPI.com](https://www.weatherapi.com/)
- Telegram Bot Token from [BotFather](https://t.me/botfather)

### 1. Installation

Clone the repository and install dependencies:

```bash
cd hafizn24-cronjob
npm install
```

### 2. Configuration

Create a `.env` file from the template:

```bash
cp .env.example .env
```

Fill in your credentials:

```env
WEATHER_API_KEY=your_weatherapi_key_here
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
TELEGRAM_CHAT_ID=@larkweathertest
LOCATION_LATITUDE=1.206
LOCATION_LONGITUDE=103.729
LOCATION_NAME=Kampong Sudong, Singapore
WEATHER_DEBUG_MODE=false
```

### 3. Local Testing

Test the cron job locally:

```bash
npm run dev
```

### 4. Deploy to Netlify

Deploy the function to Netlify:

```bash
netlify deploy --prod
```

Or connect your GitHub repo to Netlify for automatic deployments.

## 🔧 How It Works

### Architecture Overview

```
┌─────────────────────────────────────────────────┐
│         WEATHER SCHEDULING SERVICE              │
├─────────────────────────────────────────────────┤
│                                                 │
│  Netlify Scheduler (Cron)                       │
│  ├─ Triggers: @hourly                           │
│  ├─ Timezone: UTC                               │
│  └─ Retry: 3 attempts                           │
│         │                                       │
│         ▼                                       │
│  Fetch Weather Data (WeatherAPI)                │
│  └─ Current conditions + 2-hour forecast        │
│         │                                       │
│         ▼                                       │
│  Decision Engine                                │
│  ├─ Rule 1: All clear → No alert                │
│  ├─ Rule 2: Raining now, clears → Alert        │
│  └─ Rule 3: Rain incoming → Alert              │
│         │                                       │
│         ▼                                       │
│  Format & Send Alert (Telegram)                 │
│  └─ Structured message with conditions         │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Alert Rules

#### Rule 1: All Clear (Silent)
- **Condition**: No rain now + no rain in +1hr + no rain in +2hrs
- **Action**: No alert sent
- **Return**: `false`

#### Rule 2: Active Rain (Clearing Ahead)
- **Condition**: Raining now + clears within 1-2 hours
- **Action**: Send "ACTIVE ALERT" notification
- **Severity**: HIGH
- **Message**: Current conditions + clearing timeline

#### Rule 3: Incoming Rain (Forecast)
- **Condition**: No rain now + rain expected within forecast window
- **Action**: Send "INCOMING ALERT" with ETA
- **Severity**: MEDIUM/HIGH
- **Message**: Rainfall predictions + timeline

### Rain Detection

The system identifies rain using WeatherAPI condition codes:

```javascript
const RAIN_CODES = new Set([
  1063, 1072, 1087, 1150, 1153, 1168, 1171, 1180, 1183, 1186, 1189, 1192, 1195, 1198,
  1201, 1240, 1243, 1246, 1273, 1276,
]);
```

### Alert Message Format

```
╔══ 🌊 CDPS LIGHTNING ALERT ══╗

📌 Kampong Sudong, Singapore
🗓️ 2026-04-06 20:48

Current Conditions
──────────────────
• Condition    : Partly cloudy
• Temperature  : 30.1°C / Feels 36.8°C
• Humidity     : 59%
• Rainfall     : 1.41 mm
• Wind         : 13.3 km/h S
• Visibility   : 10 km
• Pressure     : 1009 mb
• Cloud Cover  : 75%

⚠️  INCOMING RAIN — ETA ~1 hour

Hour-by-Hour Summary
──────────────────
• Now      → 1.41mm  Partly cloudy (—%)
• +1 Hour  → 2.5mm   Moderate rain (80%)
• +2 Hours → 0.5mm   Light rain (30%)

Advisory
──────────────────
• Prepare for rain in ~1 hour
• All outdoor site and marine works activities are to cease immediately, 
  Please make your way to the nearest lightning shelter thank you

╚══ Updated: 2026-04-06 20:45 ══╝
```

## 📊 Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `WEATHER_API_KEY` | WeatherAPI key | `abc123xyz` |
| `WEATHER_API_BASE_URL` | WeatherAPI endpoint | `https://api.weatherapi.com/v1` |
| `LOCATION_LATITUDE` | Location latitude | `1.206` |
| `LOCATION_LONGITUDE` | Location longitude | `103.729` |
| `LOCATION_NAME` | Display name | `Kampong Sudong, Singapore` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | `123456:ABC...` |
| `TELEGRAM_CHAT_ID` | Target chat/channel | `@larkweathertest` |
| `TELEGRAM_API_BASE_URL` | Telegram API endpoint | `https://api.telegram.org` |
| `WEATHER_DEBUG_MODE` | Enable debug logging | `false` or `true` |

## ⏰ Schedule Configuration

### Current Schedule

The cron job is configured to run **@hourly** (every hour).

### Modify Schedule

Edit `netlify.toml`:

```toml
[functions."weather-cron"]
  schedule = "@hourly"  # Change this
```

### Cron Expression Examples

| Expression | Meaning |
|-----------|---------|
| `@hourly` | Every hour |
| `@daily` | Every day at 00:00 UTC |
| `0 */6 * * *` | Every 6 hours |
| `0 8 * * 1-5` | 8am UTC, weekdays only |
| `0 0 * * *` | Daily at midnight UTC |

Use [crontab.guru](https://crontab.guru/) to build custom expressions.

### Timezone

All schedules run in **UTC**. Adjust your times accordingly.

## 🔐 Security Notes

1. **Never commit `.env`** with real credentials
2. Use Netlify UI to set environment variables in production
3. Keep API keys and bot tokens secret
4. Restrict Telegram bot permissions to specific chats only
5. Monitor function logs for unusual activity

## 📈 Monitoring

### View Logs

In Netlify UI:
- Go to **Functions** → **weather-cron**
- Check **Logs** for execution history and errors

### Test Manually

Invoke the function without waiting for schedule:

```bash
netlify functions:invoke weather-cron
```

### Enable Debug Mode

Set `WEATHER_DEBUG_MODE=true` to get detailed debugging output in logs.

## 🛠️ Troubleshooting

### Function Not Triggering

1. Verify function is deployed: Check Netlify UI Functions page
2. Check schedule syntax: Use [crontab.guru](https://crontab.guru/)
3. Confirm environment variables are set in Netlify UI
4. Check function logs for errors

### No Alerts Sent

1. Verify Telegram bot token is correct
2. Check chat ID is valid
3. Ensure bot has permission to send messages
4. Check weather data is being fetched correctly

### Weather API Errors

1. Verify API key is valid and active
2. Check rate limits haven't been exceeded
3. Confirm location coordinates are valid
4. Monitor API usage in WeatherAPI dashboard

## ⚙️ Development

### Install Dependencies

```bash
npm install
```

### Run Locally

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Run Tests

```bash
npm test
```

## 📚 API References

- [WeatherAPI Documentation](https://www.weatherapi.com/docs/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Netlify Scheduled Functions](https://docs.netlify.com/functions/overview/#scheduled-functions)
- [Cron Expression Format](https://crontab.guru/)

## 📝 License

MIT License - See LICENSE file for details

## 👤 Author

Hafiz N24

## 🤝 Support

For issues or feature requests, please open an issue on the project repository.
