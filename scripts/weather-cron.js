const { GoogleGenerativeAI } = require('@google/generative-ai');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemma-4-26b-a4b-it' });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_API_BASE_URL = process.env.TELEGRAM_API_BASE_URL;

async function getWeatherScreenshotBase64() {
    const url = 'https://www.accuweather.com/en/my/subang-jaya/3588486/current-weather/3588486';

    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
        ],
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        );

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'font', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        console.log('🌐 Navigating to AccuWeather...');
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
        } catch (e) {
            console.log('⚠️ Page load timed out, checking for HTML content anyway...');
        }

        console.log('🕵️ Locating weather card...');
        const weatherCard = await page.waitForSelector('.current-weather-card', { timeout: 8000 });

        const base64 = await weatherCard.screenshot({ encoding: 'base64' });
        return base64;

    } finally {
        await browser.close();
    }
}

async function sendTelegramAlert(message) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_API_BASE_URL || !TELEGRAM_CHAT_ID) {
        throw new Error('Missing Telegram credentials in environment variables');
    }

    const url = `${TELEGRAM_API_BASE_URL}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML',
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Telegram API error: ${response.status} ${response.statusText} — ${errorText}`);
    }

    const result = await response.json();
    console.log('✅ Telegram alert sent:', result.ok);
    return result;
}

async function run() {
    console.log('🎯 Weather check started at', new Date().toISOString());

    try {
        const timestamp = new Date().toLocaleString('en-MY', {
            timeZone: 'Asia/Kuala_Lumpur',
            timeStyle: 'short',
            dateStyle: 'full'
        });

        const base64Image = await getWeatherScreenshotBase64();
        console.log('📸 Screenshot captured, sending to Gemma 4...');

        const prompt = `
You are a data extractor. Look at this weather screenshot and reply with ONLY the following block, nothing else, no explanation:

🌤 Weather Update — Subang Jaya
🕐 ${timestamp} MYT

Condition : [value]
Temperature: [number]°C
Humidity : [number]%
Rainfall : [number] mm
Raining now: [Yes/No]

📡 Source: AccuWeather (Gemma 4)

Do not add any other text before or after this block.`;

        const result = await model.generateContent([
            { inlineData: { data: base64Image, mimeType: 'image/png' } },
            prompt
        ]);

        const fullText = result.response.text().trim();
        const marker = '🌤 Weather Update';
        const startIndex = fullText.lastIndexOf(marker);
        const finalMessage = startIndex !== -1 ? fullText.substring(startIndex) : fullText;

        await sendTelegramAlert(finalMessage);
        console.log('✅ Success:\n', finalMessage);

    } catch (err) {
        console.error('❌ Failed:', err.message);
        process.exit(1); // marks the GitHub Actions job as failed
    }
}

run();