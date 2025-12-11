// server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Configuration, OpenAIApi } = require('openai');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 4242;

app.use(bodyParser.json());

// Serve the audit wizard frontend
app.use(express.static(path.join(__dirname, '../frontend/audit-wizard')));

// Serve the results pages
app.use('/results', express.static(path.join(__dirname, '../frontend/results')));

// ---------------------------
// OPENAI CONFIG
// ---------------------------
const openaiKey = process.env.OPENAI_API_KEY;

const openaiConfig = new Configuration({
  apiKey: openaiKey,
});

const openai = new OpenAIApi(openaiConfig);

// ---------------------------
// EMAIL CONFIG
// ---------------------------
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_SMTP_HOST,
  port: parseInt(process.env.EMAIL_SMTP_PORT || '587'),
  secure: process.env.EMAIL_SMTP_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_SMTP_USER,
    pass: process.env.EMAIL_SMTP_PASS,
  },
});

// ---------------------------
// SCORING LOGIC
// ---------------------------
function mapOptionToPoints(opt) {
  const map = {
    never: 0,
    occasionally: 5,
    weekly: 10,
    daily: 15,
    '0-1': 0,
    '2-3': 5,
    '4-5': 10,
    auto: 15,
    head: 0,
    notes: 5,
    some: 10,
    freq: 0,
    sometimes: 5,
    rare: 10,
  };

  if (!opt) return 0;
  if (!isNaN(opt)) return Math.max(0, Math.min(15, Math.round((parseInt(opt) / 10) * 15)));

  return map[opt] || 0;
}

function calculateScores(ans) {
  const contentScore = Math.round(
    ((mapOptionToPoints(ans.consistency) + mapOptionToPoints(ans.score_content)) / 30) * 100
  );

  const salesScore = Math.round(
    ((mapOptionToPoints(ans.followups) + mapOptionToPoints(ans.score_sales)) / 30) * 100
  );

  const opsScore = Math.round(
    ((mapOptionToPoints(ans.taskmgmt) + mapOptionToPoints(ans.missdeadlines) + mapOptionToPoints(ans.score_ops)) / 45) * 100
  );

  const overall = Math.round((contentScore + salesScore + opsScore) / 3);

  return { contentScore, salesScore, opsScore, overall };
}

// ---------------------------
// AI PROMPT
// ---------------------------
function buildAIPrompt(answers, scores) {
  return `
You are an expert AI systems architect.

A prospect completed an audit. Produce a concise (markdown) personalized systems diagnosis.

Include:
1) Tool stack summary (use their words)
2) Frustration analysis
3) Ideal system outcome
4) Score breakdown
5) Top 3 bottlenecks
6) Recommended PromptProfit tier (Starter, Pro, Build-Out, Enterprise)
7) Clear next steps for improvement

Answers:
${JSON.stringify(answers, null, 2)}

Scores:
${JSON.stringify(scores, null, 2)}
`;
}

// ---------------------------
// PRODUCT ROUTING LOGIC
// ---------------------------
function chooseProduct(scores) {
  const fails = [];

  if (scores.contentScore < 40) fails.push('content');
  if (scores.salesScore < 40) fails.push('sales');
  if (scores.opsScore < 40) fails.push('ops');

  if (fails.length >= 2)
    return { tier: 'enterprise', route: '/results/enterprise.html' };

  if (fails.length === 1)
    return { tier: 'build-' + fails[0], route: `/results/build-${fails[0]}.html` };

  if (scores.overall < 40)
    return { tier: 'starter', route: '/results/starter.html' };

  if (scores.overall < 66)
    return { tier: 'pro', route: '/results/pro.html' };

  return { tier: 'pro', route: '/results/pro.html' };
}

// ---------------------------
// PDF GENERATION
// ---------------------------
async function renderPDF(html) {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });

  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' },
  });

  await browser.close();
  return pdf;
}

// ---------------------------
// REPORT TEMPLATE
// ---------------------------
function buildReportHTML(profile, diagnosis, scores) {
  return `
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    h1 { margin-bottom: 0; }
    .section { margin-top: 20px; padding: 10px; background: #f7f9fb; border-radius: 8px; }
    .score-box { display: inline-block; margin-right: 10px; padding: 10px; background: #eceff4; border-radius: 6px; }
  </style>
</head>
<body>

<h1>PromptProfit Systems Audit</h1>

<div class="section">
  <h3>Profile Summary</h3>
  <p>${profile.business_type} — ${profile.stage}</p>
  <p>Revenue: ${profile.revenue}</p>
  <p>Offer: ${profile.primary_offer}</p>
</div>

<div class="section">
  <h3>Scores</h3>
  <div class="score-box">Content: ${scores.contentScore}</div>
  <div class="score-box">Sales: ${scores.salesScore}</div>
  <div class="score-box">Ops: ${scores.opsScore}</div>
  <div class="score-box">Overall: ${scores.overall}</div>
</div>

<div class="section">
  <h3>Diagnosis</h3>
  <p>${diagnosis.replace(/\n/g, '<br>')}</p>
</div>

</body>
</html>
`;
}

// ---------------------------
// MAIN ENDPOINT
// ---------------------------
app.post('/api/audit/submit', async (req, res) => {
  try {
    const answers = req.body.answers;

    const scores = calculateScores(answers);
    const prompt = buildAIPrompt(answers, scores);

    // OpenAI call
    const aiResp = await openai.createCompletion({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      prompt,
      max_tokens: 900,
      temperature: 0.2,
    });

    const diagnosis = aiResp.data.choices[0].text.trim();

    const choice = chooseProduct(scores);

    const pdfHTML = buildReportHTML(answers, diagnosis, scores);
    const pdf = await renderPDF(pdfHTML);

    // Send email
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: answers.email,
      subject: `Your PromptProfit Audit Report`,
      text: `Your audit is ready. View your recommended next step: ${process.env.BASE_URL}${choice.route}`,
      attachments: [
        { filename: 'PromptProfit-Audit.pdf', content: pdf },
      ],
    });

    return res.json({ success: true, redirect: choice.route });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ---------------------------
// START SERVER
// ---------------------------
app.listen(PORT, () => {
  console.log(`Audit server running on port ${PORT}`);
});
