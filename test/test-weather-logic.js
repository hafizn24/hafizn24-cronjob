/**
 * Test file for Weather Cron Logic
 * Run with: node test/test-weather-logic.js
 */

const RAIN_CODES = new Set([
  1063, 1072, 1087, 1150, 1153, 1168, 1171, 1180, 1183, 1186, 1189, 1192, 1195, 1198,
  1201, 1240, 1243, 1246, 1273, 1276,
]);

function isRainy(conditionCode) {
  return RAIN_CODES.has(conditionCode);
}

// Test Case 1: All clear (no rain)
console.log('\n✅ Test 1: All Clear Conditions');
console.log('Expected: false (no alert)');
const clear1 = [
  { code: 1000, name: 'Clear' }, // now
  { code: 1003, name: 'Partly Cloudy' }, // +1h
  { code: 1003, name: 'Partly Cloudy' }, // +2h
];
console.log('Rain status:', clear1.map((c) => `${c.name}(${isRainy(c.code)})`).join(' | '));
console.log(
  'Result:',
  !isRainy(clear1[0].code) && !isRainy(clear1[1].code) && !isRainy(clear1[2].code)
    ? '✅ PASS'
    : '❌ FAIL'
);

// Test Case 2: Raining now but clears
console.log('\n✅ Test 2: Active Rain (Clearing Ahead)');
console.log('Expected: true (ACTIVE ALERT)');
const active1 = [
  { code: 1189, name: 'Moderate Rain' }, // now
  { code: 1003, name: 'Partly Cloudy' }, // +1h
  { code: 1000, name: 'Clear' }, // +2h
];
console.log('Rain status:', active1.map((c) => `${c.name}(${isRainy(c.code)})`).join(' | '));
const activeResult =
  isRainy(active1[0].code) &&
  !isRainy(active1[1].code) &&
  !isRainy(active1[2].code);
console.log('Result:', activeResult ? '✅ PASS' : '❌ FAIL');

// Test Case 3: Incoming rain
console.log('\n✅ Test 3: Incoming Rain (Forecast Alert)');
console.log('Expected: true (INCOMING ALERT ~1 hour)');
const incoming1 = [
  { code: 1003, name: 'Partly Cloudy' }, // now
  { code: 1183, name: 'Light Rain' }, // +1h
  { code: 1003, name: 'Partly Cloudy' }, // +2h
];
console.log('Rain status:', incoming1.map((c) => `${c.name}(${isRainy(c.code)})`).join(' | '));
const incomingResult =
  !isRainy(incoming1[0].code) &&
  (isRainy(incoming1[1].code) || isRainy(incoming1[2].code));
console.log('Result:', incomingResult ? '✅ PASS' : '❌ FAIL');

// Test Case 4: Incoming rain in 2 hours
console.log('\n✅ Test 4: Incoming Rain (2-hour ETA)');
console.log('Expected: true (INCOMING ALERT ~2 hours)');
const incoming2 = [
  { code: 1003, name: 'Partly Cloudy' }, // now
  { code: 1003, name: 'Partly Cloudy' }, // +1h
  { code: 1186, name: 'Moderate Rain' }, // +2h
];
console.log('Rain status:', incoming2.map((c) => `${c.name}(${isRainy(c.code)})`).join(' | '));
const incomingResult2 =
  !isRainy(incoming2[0].code) &&
  (isRainy(incoming2[1].code) || isRainy(incoming2[2].code));
console.log('Result:', incomingResult2 ? '✅ PASS' : '❌ FAIL');

// Test Case 5: Continuous rain
console.log('\n✅ Test 5: Continuous Rain (No Quick Clearing)');
console.log('Expected: true (ACTIVE + FORECAST ALERT)');
const continuous = [
  { code: 1189, name: 'Moderate Rain' }, // now
  { code: 1186, name: 'Moderate Rain' }, // +1h
  { code: 1003, name: 'Partly Cloudy' }, // +2h
];
console.log('Rain status:', continuous.map((c) => `${c.name}(${isRainy(c.code)})`).join(' | '));
const continuousResult =
  isRainy(continuous[0].code) &&
  (isRainy(continuous[1].code) || isRainy(continuous[2].code));
console.log('Result:', continuousResult ? '✅ PASS' : '❌ FAIL');

console.log('\n' + '='.repeat(60));
console.log('All test cases completed!');
console.log('='.repeat(60));
