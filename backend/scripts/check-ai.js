/**
 * Live Gemini self-check:  npm run check:ai   (from the backend folder)
 * Tries each configured model with a tiny real quiz request and tells you
 * exactly what is wrong (bad key, retired model, quota...).
 */
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { generateQuiz, resolveModels, isUsableApiKey, classifyAiError } from '../services/quizGenerator.js';

dotenv.config();

const key = (process.env.GEMINI_API_KEY || '').trim().replace(/^['"]|['"]$/g, '');
if (!isUsableApiKey(key)) {
  console.error('FAIL: GEMINI_API_KEY is missing or still a placeholder in backend/.env.');
  console.error('Get a key at https://aistudio.google.com/apikey, put it in backend/.env, then re-run.');
  process.exit(1);
}

const models = resolveModels(process.env.GEMINI_MODEL);
const ai = new GoogleGenAI({ apiKey: key, httpOptions: { timeout: 60000 } });
let working = 0;

for (const model of models) {
  process.stdout.write(`Checking ${model} ... `);
  try {
    const quiz = await generateQuiz({
      ai, topic: 'basic geography', difficulty: 'easy', count: 3,
      models: [model], logger: { log() {}, warn() {} }, retryDelayMs: 500
    });
    working += 1;
    console.log(`OK (${quiz.questions.length} valid questions)`);
    if (working === 1) {
      const q = quiz.questions[0];
      console.log(`  sample: ${q.questionText}\n  options: ${q.options.join(' | ')}\n  answer: ${q.options[q.correctAnswerIndex]}`);
    }
  } catch (err) {
    const info = err.details ? { kind: err.code, message: err.details[0] } : classifyAiError(err);
    console.log(`FAIL [${info.kind}] ${info.message}`);
  }
}

if (working === 0) {
  console.error('\nNo model worked. Set GEMINI_MODEL in backend/.env to a current model:');
  console.error('https://ai.google.dev/gemini-api/docs/deprecations');
  process.exit(1);
}
console.log(`\n${working}/${models.length} model(s) working. Quiz generation is ready.`);
