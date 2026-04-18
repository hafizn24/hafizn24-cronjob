Netlify handles cron jobs through Scheduled Functions — here's how to set it up:

Step 1: Install the Netlify Functions package
bash
npm install @netlify/functions
Step 2: Create your function file
Place it in netlify/functions/, e.g. netlify/functions/my-cron.js:

Option A — Inline schedule (JS/TS only):

js
const { schedule } = require('@netlify/functions');

const handler = async (event, context) => {
  console.log("Cron job running!");
  // your logic here
  return { statusCode: 200 };
};

module.exports.handler = schedule("@daily", handler);
Option B — Schedule in netlify.toml:

js
// netlify/functions/my-cron.js
exports.handler = async (event, context) => {
  console.log("Running!");
  return { statusCode: 200 };
};
toml
# netlify.toml
[functions."my-cron"]
  schedule = "0 8 * * 1-5"  # 8am UTC, weekdays
Step 3: Use a cron expression
Scheduled functions use the cron expression format and run in UTC timezone. For example, 0 0 * * * runs every day at midnight UTC. 
Netlify Docs

Netlify also supports shorthand aliases:

Expression	Meaning
@hourly	Every hour
@daily	Every day at 00:00
@weekly	Every Sunday at 00:00
@monthly	First day of the month
Use crontab.guru to build custom expressions.

Step 4: Deploy and monitor
Once deployed, the function will appear on the Netlify UI's Functions page with a Scheduled badge, showing the next execution date and time in your local timezone. 
Netlify Docs

To test locally without waiting for the schedule:

bash
netlify functions:invoke my-cron
Important limits
Scheduled functions have a 30-second execution limit. 
Netlify Docs
They only run on published deploys, not deploy previews, and cannot be triggered directly via URL in production. 
Netlify Docs
They don't support POST payloads — use a regular serverless function if you need that.
show the folder structure and step by step to make

8:29 PM


That covers the full picture. A few things to keep in mind:

The two files you must create are netlify/functions/my-cron.js (the function itself) and optionally netlify.toml (if you want to set the schedule outside the code). The netlify/functions/ folder name is important — Netlify auto-detects it.

Inline vs toml schedule — use the schedule() wrapper in your JS file if you want everything in one place. Use netlify.toml if you manage multiple functions and want their schedules visible in a single config file. Don't use both at the same time for the same function.

30-second limit — scheduled functions time out after 30 seconds, so keep the logic lean. If you need longer tasks (e.g. processing large datasets), break them into smaller chunks or chain multiple functions.

Use crontab.guru to build and verify your cron expression before deploying.

