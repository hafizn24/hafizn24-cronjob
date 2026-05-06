const { runAIWeatherCheck } = require('../lib/ai-weather');

module.exports.handler = async (event, context) => {
  console.log('AI Weather triggered via HTTP at', new Date().toISOString());
  return runAIWeatherCheck();
};
