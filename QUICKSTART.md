# 🚀 Weather Cron Job - Quick Reference Guide

## 📂 Project Overview

A serverless **weather monitoring system** that runs on Netlify and sends automated alerts via Telegram when rain is detected or forecasted.

**Built with**: Node.js, Netlify Functions, WeatherAPI, Telegram Bot API

## 🎯 What It Does

Every hour, the system:
1. Fetches current weather + 2-hour forecast from WeatherAPI
2. Analyzes rainfall conditions across three time windows
3. Applies intelligent alert rules
4. Sends formatted notifications to Telegram if conditions warrant

## 📊 Alert Decision Rules

| Rule | Condition | Action | Example |
|------|-----------|--------|---------|
| **1** | No rain now/+1h/+2h | Silent | ☀️ Clear day |
| **2** | Rain now, clears in 1-2h | 🚨 ACTIVE ALERT | 🌧️ → Clear |
| **3** | Rain incoming in forecast | ⚠️ FORECAST ALERT | Clear → 🌧️ |

## 🏗️ Project Files

```
netlify/functions/weather-cron.js   ← Main handler (490 lines)
netlify.toml                         ← Schedule & config (@hourly)
package.json                         ← Dependencies
.env.example                         ← Credential template
SETUP.md                             ← Full setup guide
DELIVERY.md                          ← Delivery summary
.gitignore                           ← Git configuration
test/test-weather-logic.js           ← Unit tests
```

## ⚡ Quick Setup (5 minutes)

### Step 1: Install
```bash
npm install
```

### Step 2: Configure
```bash
cp .env.example .env
# Edit .env and add:
# - WEATHER_API_KEY (from weatherapi.com)
# - TELEGRAM_BOT_TOKEN (from @botfather)
# - LOCATION_LATITUDE / LONGITUDE
```

### Step 3: Test
```bash
npm run dev
```

### Step 4: Deploy
```bash
npm install -g netlify-cli
netlify deploy --prod
```

Or use GitHub → Netlify automatic deployment.

## 🔑 Required Credentials

### 1. WeatherAPI Key
- Visit: https://www.weatherapi.com/
- Sign up (free tier available)
- Copy API key to `WEATHER_API_KEY`

### 2. Telegram Bot Token
- Open Telegram, find [@BotFather](https://t.me/botfather)
- Send `/newbot`, follow prompts
- Copy token to `TELEGRAM_BOT_TOKEN`
- Default chat: `@larkweathertest` (modify in `.env`)

## ⚙️ Configuration

### Environment Variables (.env)

```env
# Required
WEATHER_API_KEY=your_key_here
TELEGRAM_BOT_TOKEN=your_token_here
LOCATION_LATITUDE=1.206
LOCATION_LONGITUDE=103.729

# Optional
LOCATION_NAME=Kampong Sudong
TELEGRAM_CHAT_ID=@larkweathertest
WEATHER_DEBUG_MODE=false
```

### Schedule (netlify.toml)

```toml
[functions."weather-cron"]
  schedule = "@hourly"        # Change frequency here
```

**Common schedules:**
- `@hourly` = Every hour
- `@daily` = Daily at midnight UTC
- `0 */6 * * *` = Every 6 hours
- `0 8 * * 1-5` = 8am UTC, weekdays

## 📡 How It Works

```
+──────────────────────────────────────+
│  Netlify Scheduler (Cron Job)        │
│  Trigger: Every hour @UTC            │
+──────────────────────────────────────+
                 ↓
+──────────────────────────────────────+
│  Fetch Weather Data                  │
│  • Current conditions                │
│  • +1 hour forecast                  │
│  • +2 hour forecast                  │
│  From: api.weatherapi.com            │
+──────────────────────────────────────+
                 ↓
+──────────────────────────────────────+
│  Decision Engine                     │
│  ✓ Detect rain using condition codes │
│  ✓ Apply 3 alert rules               │
│  ✓ Determine alert type              │
+──────────────────────────────────────+
                 ↓
        ┌────────┴────────┐
        ↓                 ↓
    No Alert         Send Alert
    (silent)      (Telegram message)
```

## 🔍 Alert Message Example

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

⚠️  INCOMING RAIN — ETA ~1 hour

Hour-by-Hour Summary
──────────────────
• Now      → 1.41mm  Partly cloudy
• +1 Hour  → 2.5mm   Moderate rain
• +2 Hours → 0.5mm   Light rain

Advisory
──────────────────
• Prepare for rain in ~1 hour
• All activities: cease & seek shelter

╚══ Updated: 2026-04-06 20:45 ══╝
```

## 🧪 Testing

### Run Unit Tests
```bash
npm test
```

### Test Locally
```bash
npm run dev
```

### Manual Function Invoke
```bash
netlify functions:invoke weather-cron
```

## 📊 Monitoring

### View Logs
1. Go to Netlify Dashboard
2. Functions → weather-cron → Logs
3. See execution history and errors

### Enable Debug Mode
Set in `.env`:
```env
WEATHER_DEBUG_MODE=true
```

Check logs for detailed decision tree output.

## 🚨 Troubleshooting

| Issue | Solution |
|-------|----------|
| Function not running | Check Netlify UI, verify schedule syntax |
| No alerts sent | Check API keys, verify Telegram bot permission |
| Weather API errors | Verify credentials, check rate limits |
| Timeout (>30s) | Keep logic lean, optimize API calls |

## 🔐 Security

✅ **Do:**
- Use `.env` for credentials
- Add `.env` to `.gitignore`
- Set env vars in Netlify UI for production
- Rotate API keys regularly

❌ **Don't:**
- Commit `.env` with real credentials
- Hardcode secrets in source code
- Log sensitive information
- Share bot tokens publicly

## 📚 Documentation

- **SETUP.md** - Complete setup & deployment guide
- **DELIVERY.md** - Project delivery summary
- **README.md** - Feature overview
- Visit our reference docs folder for architecture details

## 🔗 Useful Links

- **WeatherAPI**: https://www.weatherapi.com/docs/
- **Telegram API**: https://core.telegram.org/bots/api
- **Netlify Functions**: https://docs.netlify.com/functions/overview/
- **Cron Builder**: https://crontab.guru/

## 📝 Common Tasks

### Change Alert Frequency
Edit `netlify.toml`:
```toml
schedule = "@daily"  # Changed from @hourly
```

### Change Location
Edit `.env`:
```env
LOCATION_LATITUDE=1.3521
LOCATION_LONGITUDE=103.8198
LOCATION_NAME=Singapore City
```

### Change Alert Channel
Edit `.env`:
```env
TELEGRAM_CHAT_ID=123456789  # Your personal chat ID
# or
TELEGRAM_CHAT_ID=-100123456789  # Group chat ID
```

### Enable Debug Logging
Edit `.env`:
```env
WEATHER_DEBUG_MODE=true
```

## 📞 Support

1. Check SETUP.md for detailed guide
2. Review logs in Netlify UI
3. Verify API key credentials
4. Test with: `npm run dev`
5. Check API documentation

## ✅ Deployment Checklist

- [ ] API keys obtained (WeatherAPI, Telegram)
- [ ] `.env` file configured
- [ ] `.env` added to `.gitignore`
- [ ] `npm install` completed
- [ ] `npm run dev` tested locally
- [ ] Repo pushed to GitHub
- [ ] Netlify connected & env vars set
- [ ] First deployment successful
- [ ] Logs checked for errors
- [ ] Test alert received via Telegram

## 🎉 Ready to Deploy!

Everything is set up and ready. Just:
1. Get your API keys
2. Configure `.env`
3. Push to GitHub
4. Connect to Netlify

That's it! Your weather monitoring system will be live and running hourly.

---

**Questions?** Check SETUP.md or visit the documentation in the `instruction/` folder.
