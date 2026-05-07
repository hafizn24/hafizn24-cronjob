const { runAIWeatherCheck } = require('../functions/weather-check-background');

module.exports.handler = async (event, context) => {
  console.log('AI Weather triggered via HTTP at', new Date().toISOString());
  return runAIWeatherCheck();
};
