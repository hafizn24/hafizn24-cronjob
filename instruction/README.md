## Architecture Design

### Weather Report Scheduling Endpoint

This section documents the architecture design for a **standalone** automated weather report scheduling endpoint that will be integrated into the hafizn24-server in future iterations.

#### Overview

The Weather Report Scheduling system is a microservice that:
- Fetches real-time weather data from WeatherAPI
- Analyzes weather patterns and conditions for outdoor marine activities
- Generates intelligent alerts based on predefined rules
- Distributes alerts via Telegram to stakeholders
- Operates on a scheduled basis (configurable intervals)

#### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                   WEATHER SCHEDULING SERVICE                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐     ┌──────────────┐    ┌──────────────┐  │
│  │   Scheduler  │────▶│  Weather API │───▶│ Alert Logic  │  │
│  │  (Cron Job)  │     │  (WeatherAPI)│    │  (Decision   │  │
│  └──────────────┘     └──────────────┘    │   Engine)    │  │
│                                           └──────────────┘  │
│                                                  │          │
│                                                  ▼          │
│                                            ┌──────────────┐ │
│                                            │ Formatter    │ │
│                                            │ (Alert Text) │ │
│                                            └──────────────┘ │
│                                                  │          │
│                                                  ▼          │
│                                            ┌──────────────┐ │
│                                            │  Telegram    │ │
│                                            │  Notification│ │
│                                            └──────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### API Endpoint Design

**Future Endpoint:**
```
POST /api/weather/schedule-report
```

**Request Payload:**
```json
{
  "location": {
    "latitude": 1.2079,
    "longitude": 103.7202,
    "name": "Changi Beach"
  },
  "schedule": {
    "interval": 3600,           // seconds (1 hour)
    "enabled": true,
    "timezone": "Asia/Singapore"
  },
  "notification": {
    "method": "telegram",
    "chatId": "@larkweathertest",
    "botToken": "YOUR_BOT_TOKEN"
  },
  "alertRules": {
    "includeDebug": false,
    "rainyThreshold": 0.5,      // mm precipitation
    "windSpeedAlert": 40        // km/h
  }
}
```

**Response:**
```json
{
  "success": true,
  "scheduleId": "sched_123abc",
  "status": "active",
  "message": "Weather report scheduled successfully",
  "nextRun": "2026-04-06T15:00:00Z"
}
```

#### Data Flow

1. **Scheduler Trigger**
   - Cron job or internal scheduler triggers at configured interval
   - Validates schedule configuration and status

2. **Weather Data Retrieval**
   - Calls WeatherAPI endpoint:
     ```
     https://api.weatherapi.com/v1/forecast.json?key={token}&q={lat},{lon}&aqi=no&alerts=no
     ```
   - Extracts:
     - Current conditions (temperature, rainfall, wind, humidity, pressure, etc.)
     - Hourly forecast data (next 2 hours minimum)
     - Location information

3. **Decision Engine / Alert Logic**
   - Analyzes weather conditions against predefined rules:
     
     **Rule 1: All Clear**
     - Condition: No rain now, no rain in next 1hr, no rain in next 2hrs
     - Action: Silent (no alert sent)
     - Return: `false`
     
     **Rule 2: Active Rain (Clearing Ahead)**
     - Condition: Raining now, but clears within 1-2 hours
     - Action: Send "ACTIVE ALERT" notification
     - Severity: HIGH
     - Message includes current conditions and clearing timeline
     
     **Rule 3: Incoming Rain (Forecast)**
     - Condition: No rain now, but rain expected within forecast window
     - Action: Send "INCOMING ALERT" with ETA
     - Severity: MEDIUM/HIGH
     - Message includes rainfall predictions and timeline

4. **Weather Data Processing**
   ```javascript
   // Rain condition detection
   const RAIN_CODES = new Set([
     1063, 1072, 1087, 1150, 1153, 1168, 1171, 1180, 1183, 1186, 1189, 1192, 1195, 1198,
     1201, 1240, 1243, 1246, 1273, 1276,
   ]);
   
   // Evaluate three time windows:
   // - Current conditions (now)
   // - +1 hour forecast
   // - +2 hours forecast
   ```

5. **Alert Message Formatting**
   - Generates structured, visually formatted alert text
   - Includes:
     - Location and timestamp
     - Current weather conditions (detailed)
     - Hourly summary
     - Wind warnings (if wind ≥ 40 km/h)
     - Advisory text
     - Optional debug information
   
   **Sample Alert Output:**
   ```
   ╔══ 🌊 CDPS LIGHTNING ALERT ══╗
   
   📌 Changi Beach, Singapore
   🗓️ 2026-04-06 15:30
   
   Current Conditions
   ──────────────────
   • Condition    : Moderate rain
   • Temperature  : 28°C / Feels 32°C
   • Humidity     : 85%
   • Rainfall     : 2.5 mm
   • Wind         : 35 km/h NE
   • Visibility   : 8 km
   • Pressure     : 1010 mb
   • Cloud Cover  : 90%
   
   🚨 RAIN ALERT — ACTIVE NOW
   ──────────────────
   • Status       : RAINING NOW
   • Clearing     : Expected within 1–2 hours
   
   Hour-by-Hour Summary
   ──────────────────
   • Now       → 2.5mm  Moderate rain (80%)
   • +1 Hour   → 1.2mm  Light rain (60%)
   • +2 Hours  → 0.0mm  Overcast (10%)
   
   Advisory
   ──────────────────
   • All outdoor site and marine works activities are to cease immediately.
     Please make your way to the nearest lightning shelter. Thank you.
   
   ╚══ Updated: 2026-04-06 15:30 ══╝
   ```

6. **Notification Delivery**
   - Sends formatted alert via Telegram API:
     ```
     POST https://api.telegram.org/{botToken}/sendMessage
     {
       "chat_id": "@larkweathertest",
       "text": "...formatted alert message..."
     }
     ```




#### Configuration Variables

```env
# Weather API Configuration
WEATHER_API_KEY=your_weatherapi_key
WEATHER_API_BASE_URL=https://api.weatherapi.com/v1

# Telegram Integration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_API_BASE_URL=https://api.telegram.org

# Schedule Configuration
WEATHER_SCHEDULE_INTERVAL=3600              # seconds (1 hour)
WEATHER_DEBUG_MODE=false
```