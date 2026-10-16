/**
 * End-to-end test: starts the real Express server (in-memory mode, no MongoDB)
 * and points the real @google/genai SDK at a local FAKE Gemini API
 * (GOOGLE_GEMINI_BASE_URL). Verifies the whole path:
 *   signup -> login token -> /api/quiz/generate -> analytics -> stats
 * and the failure paths (placeholder key, invalid key, retired model).
 *
 * It cannot prove Google accepts the request (no network in tests), but it
 * does prove the SDK builds a valid request from our config and that every
 * response shape is handled.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverFile = path.join(__dirname, '..', 'server.js');

const FAKE_KEY = 'AIzaSyFAKE-test-key-0123456789abcdefghij';
const received = []; // requests the fake Gemini saw
let fakeMode = 'ok';
let fakeGemini;
let fakePort;
const children = [];

function validQuestions(n, offset = 0) {
  return Array.from({ length: n }, (_, i) => ({
    questionText: `Which of the following correctly describes concept number ${offset + i + 1} in photosynthesis?`,
    options: [`Right ${offset + i + 1}`, `Wrong A ${offset + i + 1}`, `Wrong B ${offset + i + 1}`, `Wrong C ${offset + i + 1}`],
    explanation: `Right ${offset + i + 1} is accurate; the other options describe unrelated processes.`,
    correctAnswerIndex: 0
  }));
}

before(async () => {
  fakeGemini = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const model = (req.url.match(/models\/([^:/?]+)/) || [])[1];
      let parsed = {};
      try { parsed = JSON.parse(body); } catch (_) { /* ignore */ }
      received.push({ url: req.url, model, body: parsed });

      const send = (status, json) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      };

      if (fakeMode === 'invalid-key') {
        return send(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
      }
      if (model === 'gemini-retired') {
        return send(404, { error: { code: 404, message: `models/${model} is not found for API version v1beta, or is not supported for generateContent.`, status: 'NOT_FOUND' } });
      }
      // Ask size from the prompt so top-up rounds get what they ask for.
      const prompt = JSON.stringify(parsed.contents || '');
      const asked = parseInt((prompt.match(/exactly (\d+)/) || [])[1], 10) || 10;
      const offset = received.length * 100;
      const questions = validQuestions(asked, offset);
      send(200, {
        candidates: [{
          content: { role: 'model', parts: [{ text: JSON.stringify({ title: 'Photosynthesis Basics', questions }) }] },
          finishReason: 'STOP',
          index: 0
        }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 100, totalTokenCount: 110 }
      });
    });
  });
  await new Promise((resolve) => fakeGemini.listen(0, '127.0.0.1', resolve));
  fakePort = fakeGemini.address().port;
});

after(async () => {
  for (const c of children) c.kill();
  await new Promise((resolve) => fakeGemini.close(resolve));
});

let portCounter = 5200 + Math.floor(Math.random() * 500);

async function startServer(env = {}) {
  const port = portCounter++;
  const child = spawn(process.execPath, [serverFile], {
    env: {
      ...process.env,
      PORT: String(port),
      MONGO_URI: 'mongodb://127.0.0.1:1/quizforge-test', // unreachable on purpose -> in-memory mode
      GOOGLE_GEMINI_BASE_URL: `http://127.0.0.1:${fakePort}`,
      SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  children.push(child);
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return { base, child, health: await r.json() };
    } catch (_) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

async function signUp(base, email = 'e2e@example.com') {
  const cap = await (await fetch(`${base}/api/auth/captcha`)).json();
  const answer = cap.svg.match(/<text[^>]*>([^<]+)<\/text>/)[1];
  const signup = await (await fetch(`${base}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'E2E User', email, password: 'Passw0rd!', captchaId: cap.captchaId, captchaAnswer: answer })
  })).json();
  assert.equal(signup.success, true);
  assert.ok(signup.devOtp, 'dev OTP is returned when SMTP is not configured');
  const verify = await (await fetch(`${base}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp: signup.devOtp })
  })).json();
  assert.ok(verify.token);
  return verify.token;
}

const post = (base, token, url, body) =>
  fetch(`${base}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });

test('full flow: signup -> generate real MCQs via SDK -> analytics -> stats', async () => {
  fakeMode = 'ok';
  received.length = 0;
  const { base, health } = await startServer({
    GEMINI_API_KEY: FAKE_KEY,
    GEMINI_MODEL: 'gemini-retired,gemini-3.8-flash'
  });
  assert.equal(health.ai.configured, true);
  assert.deepEqual(health.ai.models, ['gemini-retired', 'gemini-3.8-flash']);

  const token = await signUp(base);

  const res = await post(base, token, '/api/quiz/generate', { topic: 'Photosynthesis', difficulty: 'Medium', count: 10 });
  const data = await res.json();
  assert.equal(res.status, 201, JSON.stringify(data));
  assert.equal(data.quiz.questions.length, 10);
  assert.equal(data.quiz.title, 'Photosynthesis Basics');
  assert.equal(data.quiz.difficulty, 'medium');
  assert.equal(data.meta.model, 'gemini-3.8-flash');
  for (const q of data.quiz.questions) {
    assert.equal(q.options.length, 4);
    assert.match(q.options[q.correctAnswerIndex], /^Right \d+$/);
  }
  const positions = new Set(data.quiz.questions.map((q) => q.correctAnswerIndex));
  assert.ok(positions.size > 1, 'answers should be shuffled');

  // retired model was tried first, then the working one
  assert.deepEqual(received.map((r) => r.model), ['gemini-retired', 'gemini-3.8-flash']);
  const sent = received[1].body;
  assert.equal(sent.generationConfig.responseMimeType, 'application/json');
  assert.equal(sent.generationConfig.responseJsonSchema.type, 'object');
  assert.ok(JSON.stringify(sent.contents).includes('Photosynthesis'));
  assert.ok(sent.systemInstruction, 'system instruction is sent');

  // analytics
  const quizId = data.quiz._id;
  const bad = await post(base, token, '/api/quiz/analytics', { quizId, finalScore: 11, totalQuestions: 10, timeSpentSeconds: 30, antiCheatViolations: 0 });
  assert.equal(bad.status, 400, 'score above total must be rejected');
  const mismatch = await post(base, token, '/api/quiz/analytics', { quizId, finalScore: 3, totalQuestions: 5, timeSpentSeconds: 30, antiCheatViolations: 0 });
  assert.equal(mismatch.status, 400, 'totalQuestions must match the quiz');
  const ok = await post(base, token, '/api/quiz/analytics', { quizId, finalScore: 8, totalQuestions: 10, timeSpentSeconds: 95, antiCheatViolations: 1 });
  assert.equal(ok.status, 201);

  const stats = await (await fetch(`${base}/api/quiz/stats`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.equal(stats.stats.totalGenerated, 1);
  assert.equal(stats.stats.totalTaken, 1);
  assert.equal(stats.stats.averageAccuracy, 80);
});

test('25 questions are produced by multiple batched requests with no duplicates', async () => {
  fakeMode = 'ok';
  received.length = 0;
  const { base } = await startServer({ GEMINI_API_KEY: FAKE_KEY, GEMINI_MODEL: 'gemini-3.8-flash' });
  const token = await signUp(base, 'batch@example.com');
  const res = await post(base, token, '/api/quiz/generate', { topic: 'Photosynthesis', difficulty: 'easy', count: 25 });
  const data = await res.json();
  assert.equal(res.status, 201, JSON.stringify(data));
  assert.equal(data.quiz.questions.length, 25);
  assert.equal(new Set(data.quiz.questions.map((q) => q.questionText)).size, 25);
  assert.ok(received.length >= 2);
});

test('placeholder key (the shipped .env value) -> clear 503, no fake quiz', async () => {
  received.length = 0;
  const { base, health } = await startServer({ GEMINI_API_KEY: 'your_api_key_here' });
  assert.equal(health.ai.configured, false);
  const token = await signUp(base, 'nokey@example.com');
  const res = await post(base, token, '/api/quiz/generate', { topic: 'Photosynthesis', difficulty: 'easy', count: 5 });
  const data = await res.json();
  assert.equal(res.status, 503);
  assert.equal(data.code, 'AI_NOT_CONFIGURED');
  assert.match(data.error, /GEMINI_API_KEY/);
  assert.equal(data.quiz, undefined);
  assert.equal(received.length, 0, 'must not call Gemini with a placeholder key');
});

test('invalid key reported by Gemini -> 503 AI_AUTH_FAILED after a single call', async () => {
  fakeMode = 'invalid-key';
  received.length = 0;
  const { base } = await startServer({ GEMINI_API_KEY: FAKE_KEY, GEMINI_MODEL: 'gemini-3.8-flash,gemini-3.6-flash' });
  const token = await signUp(base, 'badkey@example.com');
  const res = await post(base, token, '/api/quiz/generate', { topic: 'Photosynthesis', difficulty: 'easy', count: 5 });
  const data = await res.json();
  assert.equal(res.status, 503);
  assert.equal(data.code, 'AI_AUTH_FAILED');
  assert.equal(received.length, 1);
  fakeMode = 'ok';
});

test('every configured model retired -> 503 telling the user to set GEMINI_MODEL', async () => {
  fakeMode = 'ok';
  const { base } = await startServer({ GEMINI_API_KEY: FAKE_KEY, GEMINI_MODEL: 'gemini-retired' });
  const token = await signUp(base, 'retired@example.com');
  const res = await post(base, token, '/api/quiz/generate', { topic: 'Photosynthesis', difficulty: 'easy', count: 5 });
  const data = await res.json();
  assert.equal(res.status, 503);
  assert.equal(data.code, 'AI_MODEL_UNAVAILABLE');
  assert.match(data.error, /GEMINI_MODEL/);
});

test('input validation + auth are enforced', async () => {
  const { base } = await startServer({ GEMINI_API_KEY: FAKE_KEY, GEMINI_MODEL: 'gemini-3.8-flash' });
  const noAuth = await fetch(`${base}/api/quiz/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(noAuth.status, 401);
  const token = await signUp(base, 'valid@example.com');
  assert.equal((await post(base, token, '/api/quiz/generate', { topic: '', difficulty: 'easy' })).status, 400);
  assert.equal((await post(base, token, '/api/quiz/generate', { topic: 'Math', difficulty: 'impossible' })).status, 400);
  assert.equal((await post(base, token, '/api/quiz/generate', { topic: 'Math', difficulty: 42 })).status, 400);
});
