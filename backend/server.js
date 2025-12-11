// server.js
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const puppeteer = require("puppeteer");
const nodemailer = require("nodemailer");
const OpenAI = require("openai"); // NEW V4 SDK

const app = express();
const PORT = process.env.PORT || 4242;

// ---------------------------
// STATIC FRONTEND
// ---------------------------
app.use(express.static(path.join(__dirname, "../frontend/audit-wizard")));
app.use("/results", express.static(path.join(__dirname, "../frontend/results")));

app.use(bodyParser.json());

// ---------------------------
// OPENAI CONFIG (V4)
// ---------------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ---------------------------
// SMTP CONFIG
// ---------------------------
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_SMTP_HOST,
  port: parseInt(process.env.EMAIL_SMTP_PORT || "587"),
  secure: process.env.EMAIL_SMTP_SECURE === "true",
  auth: {
    user: process.env.EMAIL_SMTP_USER,
    pass: process.env.EMAIL_SMTP_PASS
  }
});

// ---------------------------
// SCORING LOGIC
// ---------------------------
const mapOptionToPoints = (opt) => {
  const map = {
    never: 0, occasionally: 5, weekly: 10, daily: 15,
    head: 0, notes: 5, some: 10, rare: 15,
    freq: 0, sometimes: 5,
  };
  if (!opt) return 0;
  if (!isNaN(opt)) return Math.max(0, Math.min(15, Math.round((parseInt(opt) / 10) * 15)));
  return map[opt] || 0;
};

function calculateScores(ans) {
  const content = mapOptionToPoints(ans.consistency) + mapOptionToPoints(ans.score_content);
  const sales = mapOptionToPoints(ans.followups) + mapOptionToPoints(ans.score_sales);
  const ops = mapOptionToPoints(ans.taskmgmt) + mapOptionToPoints(ans.missdeadlines) + mapOptionToPoints(ans.score_ops);

  return {
    contentScore: Math.round((content / 30) * 100),
    salesScore: Math.round((sales / 30) * 100),
    opsScore: Math.round((ops / 45) * 100),
    overall: Math.round(((content / 30) * 100 + (sales / 30) * 100 + (ops / 45) * 100) / 3),
  };
}

// ---------------------------
// PRODUCT LOGIC
// ---------------------------
function chooseProduct(scores) {
  const fails = [];
  if (scores.contentScore < 40) fails.push("content");
  if (scores.salesScore < 40) fails.push("sales");
  if (scores.opsScore < 40) fails.push("ops");

  if (fails.length >= 2)
    return { tier: "enterprise", route: "/results/enterprise.html" };

  if (fails.length === 1)
    return { tier: `build-${fails[0]}`, route: `/results/build-${fails[0]}.html` };

  if (scores.overall < 40)
    return { tier: "starter", route: "/results/starter.html" };

  return { tier: "pro", route: "/results/pro.html" };
}

// ---------------------------
// PDF BUILDER
// ---------------------------
async function renderPDF(html) {
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });

  const pdf = await page.pdf({
    format: "A4",
    printBackground: true,
    margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" }
  });

  await browser.close();
  return pdf;
}

// ---------------------------
// REPORT TEMPLATE (HTML)
// ---------------------------
function buildReportHTML(profile, diagnosis, scores) {
  return `
  <html>
  <head>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; }
      h1 { margin-bottom: 10px; }
      .box { padding: 10px; background:#f4f7fb; border-radius:8px; margin-bottom:20px; }
      .score-box { display:inline-block; padding:10px; margin-right:10px; background:#e7ecf5; border-radius:8px; }
    </style>
  </head>
  <body>

  <h1>PromptProfit Audit Report</h1>

  <div class="box">
    <h3>Business Profile</h3>
    <p><strong>Type:</strong> ${profile.business_type}</p>
    <p><strong>Stage:</strong> ${profile.stage}</p>
    <p><strong>Revenue:</strong> ${profile.revenue}</p>
    <p><strong>Offer:</strong> ${profile.primary_offer}</p>
  </div>

  <div class="box">
    <h3>Scores</h3>
    <div class="score-box">Content: ${scores.contentScore}</div>
    <div class="score-box">Sales: ${scores.salesScore}</div>
    <div class="score-box">Ops: ${scores.opsScore}</div>
    <div class="score-box">Overall: ${scores.overall}</div>
  </div>

  <div class="box">
    <h3>Diagnosis</h3>
    <p>${diagnosis.replace(/\n/g, "<br>")}</p>
  </div>

  </body>
  </html>
  `;
}

// ---------------------------
// MAIN API ENDPOINT
// ---------------------------
app.post("/api/audit/submit", async (req, res) => {
  try {
    const answers = req.body.answers;
    const scores = calculateScores(answers);

    const prompt = `
A user completed an AI business audit.

Return a structured diagnosis including:
- System weaknesses
- Bottlenecks
- Ideal automation improvements
- Recommended PromptProfit tier
- Next steps

Answers:
${JSON.stringify(answers, null, 2)}

Scores:
${JSON.stringify(scores, null, 2)}
`;

    // OPENAI V4 COMPLETION
    const aiResp = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are an expert AI systems architect." },
        { role: "user", content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 900
    });

    const diagnosis = aiResp.choices[0].message.content;

    const choice = chooseProduct(scores);
    const pdfHTML = buildReportHTML(answers, diagnosis, scores);
    const pdf = await renderPDF(pdfHTML);

    // SEND EMAIL
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: answers.email,
      subject: "Your PromptProfit Audit Report",
      text: `Your audit is ready. View your recommended plan: ${process.env.BASE_URL}${choice.route}`,
      attachments: [{ filename: "PromptProfit-Audit.pdf", content: pdf }]
    });

    return res.json({ success: true, redirect: choice.route });

  } catch (err) {
    console.error("AUDIT ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ---------------------------
app.listen(PORT, () => {
  console.log(`PromptProfit backend running on port ${PORT}`);
});
