const { runAIWeatherCheck } = require('../functions/weather-check-background');

module.exports.handler = async (event, context) => {
  console.log('AI Weather triggered via HTTP at', new Date().toISOString());
  
  // Fire and forget - run in background without waiting
  runAIWeatherCheck().catch(err => {
    console.error('Background task failed:', err.message);
  });

  // Return immediately
  return { statusCode: 202, body: 'Weather check started in background' };
};
