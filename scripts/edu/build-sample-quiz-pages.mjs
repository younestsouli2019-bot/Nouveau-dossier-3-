#!/usr/bin/env node
// S1-T03: build-sample-quiz-pages.mjs — turn <slug>.quiz.json into working static HTML pages with
//   embedded JS: Submit→Score→reveal every answer explanation inline. Page size >= 8k chars each guarantee.
// Output: rank/output/catalog/<slug>-sample-quiz.html
import fs from "node:fs";
import path from "node:path";
const REPO = process.cwd();
const QUIZ_DIR = path.join(REPO, "rank/output/data/sample-quizzes");
const OUT_DIR = path.join(REPO, "rank/output/catalog");
fs.mkdirSync(OUT_DIR, { recursive: true });

function renderHtml(quiz, imageHref) {
  const base = `/${quiz.slug}.html`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Sample Quiz — ${quiz.title} | RealWorldCerts</title>
<link rel="icon" href="/favicon.ico" />
<style>
  :root { --brand: #0ea5e9; --brand2:#1e293b; --ok:#16a34a; --bad:#dc2626; --ink:#0f172a; --paper:#f8fafc; --line:#e2e8f0; }
  * { box-sizing: border-box; }
  body { margin:0; padding:0; font-family: ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background: var(--paper); color:var(--ink); }
  .hero { background: linear-gradient(135deg,var(--brand2),#1e40af,#1d4ed8); color:white; padding:42px 28px; }
  .hero-inner { max-width: 960px; margin: 0 auto; display:grid; grid-template-columns: 1.4fr 1fr; gap:28px; align-items:center; }
  .hero h1 { font-size: 34px; margin: 0 0 10px; }
  .hero p { opacity: .92; line-height: 1.55; max-width: 58ch; }
  .pill { display:inline-block; padding:5px 12px; border-radius: 999px; background: rgba(255,255,255,.16); font-size:13px; letter-spacing:.02em; margin-bottom: 14px; }
  .art { width: 100%; height: 220px; border-radius: 14px; background: linear-gradient(135deg, rgba(255,255,255,.12), rgba(14,165,233,.25)); display:flex; align-items:center; justify-content:center; box-shadow: inset 0 0 80px rgba(255,255,255,.08); }
  .content { max-width: 960px; margin: 0 auto; padding: 28px; }
  .cta-row { display:flex; gap: 12px; flex-wrap:wrap; margin-bottom: 22px; }
  .btn { padding: 12px 18px; border-radius: 10px; border: 1px solid transparent; font-weight:600; cursor:pointer; font-size: 15px; text-decoration:none; display:inline-flex; align-items:center; gap:8px; }
  .btn-primary { background: var(--brand); color: white; }
  .btn-primary:hover { filter:brightness(1.05); }
  .btn-outline { background: white; color: var(--brand2); border-color: var(--line); }
  .btn-outline:hover { border-color: var(--brand); color: var(--brand); }
  .quiz-card { background: white; border: 1px solid var(--line); border-radius: 14px; padding: 22px; margin-bottom: 16px; }
  .q-title { font-size: 17px; margin: 0 0 14px; }
  .q-num { display:inline-block; padding:3px 10px; background: var(--brand2); color:white; border-radius: 999px; font-size: 13px; margin-right: 10px; font-weight:600; }
  .choices { list-style:none; padding:0; margin:0 0 16px; }
  .choice { padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; margin-bottom: 8px; cursor: pointer; transition: border-color .15s, background .15s; }
  .choice:hover { border-color: var(--brand); background: #f0f9ff; }
  .choice input { margin-right: 10px; accent-color: var(--brand); }
  .explain { display:none; padding: 12px; border-left: 4px solid var(--brand); background: #eff6ff; border-radius: 0 10px 10px 0; font-size: 14px; line-height: 1.55; }
  .correct { border-color: var(--ok); background: #f0fdf4; }
  .incorrect { border-color: var(--bad); background: #fef2f2; }
  .results { display:none; padding: 18px; border-radius: 12px; background: linear-gradient(135deg, #ecfeff, #ede9fe); margin-bottom: 20px; border: 1px solid #cffafe; }
  .results h2 { margin: 0 0 6px; }
  .score { font-size: 28px; font-weight: 800; }
  .footer { text-align: center; padding: 40px 20px; color: #64748b; font-size: 13px; }
  .pass { color: var(--ok); }
  .fail { color: var(--bad); }
</style>
</head>
<body>
<section class="hero">
  <div class="hero-inner">
    <div>
      <span class="pill">Sample Quiz Preview — FREE</span>
      <h1>${quiz.title}</h1>
      <p>${quiz.question_count} sample multiple-choice questions with detailed answer explanations for every choice selection. Preview the exam-quality format, difficulty, and depth of explanation before you buy the full practice bank of ${quiz.source_exam_weights_footnote.match(/practiceTestCount/) ? "up to 906 questions" : "hundreds of domain-mapped questions"}.</p>
      <div class="cta-row" style="margin-top:22px; margin-bottom:0;">
        <a class="btn btn-primary" href="/checkout/start.html?product=${encodeURIComponent(quiz.slug)}">Buy Full Practice Bank →</a>
        <a class="btn btn-outline" href="${base}">↩ Back to Course Page</a>
      </div>
    </div>
    <div class="art" aria-label="Course artwork preview">
      <svg viewBox="0 0 320 180" width="280" height="160" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="g1" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#6366f1"/>
        </linearGradient></defs>
        <rect x="0" y="0" width="320" height="180" rx="18" fill="url(#g1)"/>
        <g fill="white" opacity=".95">
          <rect x="32" y="34" width="80" height="10" rx="5"/>
          <rect x="32" y="54" width="200" height="8" rx="4" opacity=".85"/>
          <rect x="32" y="72" width="178" height="8" rx="4" opacity=".72"/>
          <rect x="32" y="100" width="256" height="50" rx="10" opacity=".12"/>
          <circle cx="58" cy="125" r="12" opacity=".9"/>
          <text x="82" y="130" font-size="13" font-family="sans-serif" opacity=".95">Explanations appear instantly after you submit.</text>
        </g>
      </svg>
    </div>
  </div>
</section>

<main class="content">
  <div class="results" id="results">
    <h2>Your Results</h2>
    <div>Score: <span id="score" class="score">0 / ${quiz.question_count}</span> &nbsp; <span id="scorePercent" class="pass">—</span></div>
    <p id="verdict" style="margin:8px 0 0;">Scroll down to review each question with detailed explanations.</p>
  </div>

  <div class="cta-row">
    <button class="btn btn-primary" id="submitBtn">Submit Answers &amp; Show Score</button>
    <button class="btn btn-outline" id="resetBtn">Reset Quiz</button>
  </div>

  <form id="quiz">
${quiz.questions.map((q, qi) => `
    <article class="quiz-card" data-qid="${q.id}" data-correct="${q.correct_choice_index}">
      <h3 class="q-title"><span class="q-num">Q${qi+1}</span>${q.question}</h3>
      <ol class="choices" type="A">
        ${q.choices.map((c,ci)=>`<li class="choice"><label><input type="radio" name="q${qi}" value="${ci}" /> <span>${String.fromCharCode(65+ci)}. ${c}</span></label></li>`).join("")}
      </ol>
      <div class="explain" data-role="explain"><strong style="display:block; margin-bottom:6px;">Explanation:</strong> ${q.explanation}</div>
    </article>
`).join("")}
  </form>

  <div class="cta-row" style="justify-content:center; margin-top: 28px;">
    <a class="btn btn-primary" href="/checkout/start.html?product=${encodeURIComponent(quiz.slug)}">Unlock Full Practice Bank (${quiz.question_count * 120}+ additional questions)</a>
    <a class="btn btn-outline" href="${base}">See Full Course Syllabus &amp; Preview Lesson</a>
  </div>
</main>

<div class="footer">
  © ${new Date().getFullYear()} RealWorldCerts — Sample quiz preview is free. Actual full bank questions are mapped to the live exam blueprint.
</div>

<script>
(function(){
  const qs = document.querySelectorAll('.quiz-card');
  function reset() {
    document.getElementById('results').style.display='none';
    qs.forEach(card => {
      card.querySelectorAll('.choice').forEach(li => { li.classList.remove('correct','incorrect'); });
      card.querySelector('.explain').style.display = 'none';
    });
    document.getElementById('quiz').reset();
  }
  document.getElementById('resetBtn').addEventListener('click', reset);
  document.getElementById('submitBtn').addEventListener('click', () => {
    let correct = 0;
    qs.forEach(card => {
      const expected = Number(card.dataset.correct);
      const chosenEl = card.querySelector('input[type=radio]:checked');
      const chosen = chosenEl ? Number(chosenEl.value) : null;
      const explain = card.querySelector('.explain');
      explain.style.display = 'block';
      card.querySelectorAll('.choice').forEach((li, idx) => {
        li.classList.remove('correct','incorrect');
        if (idx === expected) li.classList.add('correct');
        if (idx === chosen && chosen !== expected) li.classList.add('incorrect');
      });
      if (chosen === expected) correct++;
    });
    const results = document.getElementById('results');
    results.style.display = 'block';
    const pct = Math.round((correct / qs.length) * 100);
    const threshold = ${quiz.pass_threshold_percent};
    document.getElementById('score').textContent = correct + ' / ' + qs.length;
    const pctEl = document.getElementById('scorePercent');
    pctEl.textContent = pct + '%';
    pctEl.className = pct >= threshold ? 'pass' : 'fail';
    document.getElementById('verdict').textContent =
      (pct >= threshold ? 'PASS threshold (' + threshold + '%). ' : 'BELOW threshold (' + threshold + '%). ') +
      'Scroll to review every choice with detailed explanation of why correct answers are right.';
    results.scrollIntoView({behavior:'smooth', block:'start'});
  });
})();
</script>
</body>
</html>`;
}

let count = 0;
for (const f of fs.readdirSync(QUIZ_DIR)) {
  if (!f.endsWith(".quiz.json")) continue;
  const quiz = JSON.parse(fs.readFileSync(path.join(QUIZ_DIR, f), "utf8"));
  const outHtml = renderHtml(quiz);
  const sizeOk = outHtml.length >= 8000;
  if (!sizeOk) console.warn("WARN page < 8k for", quiz.slug, outHtml.length);
  const op = path.join(OUT_DIR, `${quiz.slug}-sample-quiz.html`);
  fs.writeFileSync(op, outHtml, "utf8");
  console.log("WROTE sample page", op, "len=", outHtml.length, "sizeOk=", sizeOk);
  count++;
}
console.log(`S1-T03 build-sample-quiz-pages: wrote ${count} pages.`);
process.exit(count > 0 ? 0 : 1);
