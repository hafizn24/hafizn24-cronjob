const { schedule } = require('@netlify/functions');
const { runWeatherCheck } = require('../lib/weather');

module.exports.handler = schedule('@hourly', async (event, context) => {
  console.log('🚀 Weather cron triggered at', new Date().toISOString());
  return runWeatherCheck();
});
