const https = require('https');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// 加载环境变量
const envPath = path.resolve(__dirname, '.env.local');
if (fs.existsSync(envPath)) {
  const envConfig = dotenv.parse(fs.readFileSync(envPath));
  for (const k in envConfig) {
    process.env[k] = envConfig[k];
  }
}

const apiKey = process.env.KIMI_API_KEY;
const baseUrl = process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1';

console.log('Testing Kimi API with Key:', apiKey ? (apiKey.substring(0, 8) + '...') : 'Not Set');
console.log('Base URL:', baseUrl);

if (!apiKey) {
    console.error('Error: KIMI_API_KEY is not set.');
    process.exit(1);
}

const data = JSON.stringify({
    model: process.env.KIMI_MODEL || "kimi-moonshot-v1",
    messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello! Say hi." }
    ],
    temperature: 0.3
});

const url = new URL(baseUrl + '/chat/completions');

const options = {
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    }
};

const req = https.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
        console.log('Status Code:', res.statusCode);
        try {
            const json = JSON.parse(body);
            if (res.statusCode === 200) {
                console.log('Success! Response:', json.choices[0].message.content);
            } else {
                console.error('Error Response:', json);
            }
        } catch (e) {
            console.error('Raw Response:', body);
        }
    });
});

req.on('error', (e) => {
    console.error('Request Error:', e);
});

req.write(data);
req.end();
