const { schedule } = require('@netlify/functions');
// const { runWeatherCheck } = require('../lib/weather');
const { runAIWeatherCheck } = require('../lib/ai-weather');

module.exports.handler = schedule('*/15 * * * *', async (event, context) => {
  console.log('Weather cron triggered at', new Date().toISOString());
  return runAIWeatherCheck();;
});
