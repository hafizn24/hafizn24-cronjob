const { handler } = require('../functions/weather-check-background');

async function runAIWeatherCheck() {
  console.log('🔔 Cron Job trigger received at', new Date().toISOString());

  handler({}, {}).catch(err => {
    console.error('❌ Background task error:', err.message);
  });

  return {
    statusCode: 202,
    body: JSON.stringify({ message: 'Weather check queued for background processing' })
  };
}

module.exports = { runAIWeatherCheck };