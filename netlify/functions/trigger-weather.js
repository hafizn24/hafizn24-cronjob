const { runWeatherCheck } = require('../lib/weather');

module.exports.handler = async (event, context) => {
  console.log('🚀 Weather triggered via HTTP at', new Date().toISOString());
  return runWeatherCheck();
};
