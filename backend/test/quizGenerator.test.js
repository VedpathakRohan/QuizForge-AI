import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateQuiz,
  isUsableApiKey,
  normalizeQuestion,
  shuffleQuestion,
  parseAiJson,
  resolveModels,
  QuizGenerationError,
  DEFAULT_MODELS
} from '../services/quizGenerator.js';

const silent = { log() {}, warn() {}, error() {} };

/** Builds a valid raw question the way Gemini would return it. */
function rawQ(n, overrides = {}) {
  return {
    questionText: `Which statement about closures is true (variant ${n})?`,
    options: [`Correct answer ${n}`, `Wrong A ${n}`, `Wrong B ${n}`, `Wrong C ${n}`],
    explanation: `Because correct answer ${n} is the real definition; the others are common misconceptions.`,
    correctAnswerIndex: 0,
    ...overrides
  };
}

function responseWith(questions, title = 'JS Closures Quiz') {
  return { text: JSON.stringify({ title, questions }), candidates: [{ finishReason: 'STOP' }] };
}

/** Fake `ai` whose generateContent is driven by a list of handlers (one per call). */
function fakeAi(...handlers) {
  const calls = [];
  return {
    calls,
    models: {
      async generateContent(request) {
        calls.push(request);
        const handler = handlers[Math.min(calls.length - 1, handlers.length - 1)];
        return handler(request);
      }
    }
  };
}

const apiError = (status, message) => Object.assign(new Error(message), { status });
const opts = (ai, extra = {}) => ({
  ai,
  topic: 'JavaScript closures',
  difficulty: 'medium',
  count: 5,
  models: ['model-a', 'model-b'],
  logger: silent,
  retryDelayMs: 0,
  ...extra
});

test('returns exactly the requested number of valid, shuffled MCQs', async () => {
  const ai = fakeAi(() => responseWith([1, 2, 3, 4, 5].map((n) => rawQ(n))));
  const quiz = await generateQuiz(opts(ai));

  assert.equal(quiz.questions.length, 5);
  assert.equal(quiz.title, 'JS Closures Quiz');
  assert.equal(quiz.difficulty, 'medium');
  for (const q of quiz.questions) {
    assert.equal(q.options.length, 4);
    assert.ok(q.correctAnswerIndex >= 0 && q.correctAnswerIndex <= 3);
    // the option at the answer index must still be the originally-correct text
    assert.match(q.options[q.correctAnswerIndex], /^Correct answer \d$/);
  }
});

test('request uses responseJsonSchema + JSON mime type and keeps the topic out of the system prompt', async () => {
  const ai = fakeAi(() => responseWith([1, 2, 3, 4, 5].map((n) => rawQ(n))));
  await generateQuiz(opts(ai));
  const req = ai.calls[0];
  assert.equal(req.model, 'model-a');
  assert.equal(req.config.responseMimeType, 'application/json');
  assert.equal(req.config.responseJsonSchema.type, 'object');
  assert.equal(req.config.responseSchema, undefined);
  assert.ok(req.contents.includes('"JavaScript closures"'));
  assert.ok(!req.config.systemInstruction.includes('JavaScript closures'));
});

test('correct answers are not always in the same position', async () => {
  const many = Array.from({ length: 30 }, (_, i) => rawQ(i + 1));
  const ai = fakeAi(() => responseWith(many.slice(0, 15)), () => responseWith(many.slice(15)));
  const quiz = await generateQuiz(opts(ai, { count: 30 }));
  const positions = new Set(quiz.questions.map((q) => q.correctAnswerIndex));
  assert.ok(positions.size >= 3, `expected varied answer positions, got ${[...positions]}`);
});

test('parses JSON wrapped in markdown fences and prose', async () => {
  const body = JSON.stringify({ title: 'T', questions: [1, 2, 3].map((n) => rawQ(n)) });
  const ai = fakeAi(() => ({ text: `Here is your quiz:\n\`\`\`json\n${body}\n\`\`\`\nEnjoy!` }));
  const quiz = await generateQuiz(opts(ai, { count: 3 }));
  assert.equal(quiz.questions.length, 3);
});

test('drops invalid and duplicate questions, then tops up with a second request', async () => {
  const first = [
    rawQ(1),
    rawQ(1), // duplicate
    rawQ(2, { options: ['Same', 'Same', 'x', 'y'] }), // duplicate options
    rawQ(3, { options: ['One', 'Two', 'Three', 'All of the above'] }), // positional option
    rawQ(4, { correctAnswerIndex: 7 }), // bad index
    rawQ(5, { explanation: '' }) // missing explanation
  ];
  const second = [rawQ(6), rawQ(7), rawQ(8), rawQ(9)];
  const ai = fakeAi(() => responseWith(first), () => responseWith(second));
  const quiz = await generateQuiz(opts(ai, { count: 5 }));

  assert.equal(quiz.questions.length, 5);
  assert.equal(ai.calls.length, 2);
  // the top-up request must tell the model what already exists
  assert.ok(ai.calls[1].contents.includes('variant 1'));
  assert.equal(quiz.meta.partial, false);
  assert.ok(quiz.meta.rejected.duplicate_question >= 1);
  assert.ok(quiz.meta.rejected.duplicate_options >= 1);
  assert.ok(quiz.meta.rejected.positional_option >= 1);
});

test('falls through to the next model when the first returns 404', async () => {
  const ai = fakeAi(
    () => { throw apiError(404, 'models/model-a is not found for API version v1beta'); },
    () => responseWith([1, 2, 3, 4, 5].map((n) => rawQ(n)))
  );
  const quiz = await generateQuiz(opts(ai));
  assert.equal(quiz.meta.model, 'model-b');
  assert.deepEqual(ai.calls.map((c) => c.model), ['model-a', 'model-b']);
});

test('remembers the working model for later top-up rounds', async () => {
  const ai = fakeAi(
    () => { throw apiError(404, 'models/model-a is not found'); },
    () => responseWith([rawQ(1), rawQ(2)]),
    () => responseWith([rawQ(3), rawQ(4), rawQ(5), rawQ(6)])
  );
  const quiz = await generateQuiz(opts(ai));
  assert.equal(quiz.questions.length, 5);
  assert.deepEqual(ai.calls.map((c) => c.model), ['model-a', 'model-b', 'model-b']);
});

test('invalid API key stops immediately with a clear message (does not try every model)', async () => {
  const ai = fakeAi(() => { throw apiError(400, JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } })); });
  await assert.rejects(generateQuiz(opts(ai)), (err) => {
    assert.ok(err instanceof QuizGenerationError);
    assert.equal(err.code, 'AI_AUTH_FAILED');
    assert.equal(err.httpStatus, 503);
    assert.match(err.userMessage, /GEMINI_API_KEY/);
    return true;
  });
  assert.equal(ai.calls.length, 1);
});

test('all models retired -> actionable AI_MODEL_UNAVAILABLE error, never fake questions', async () => {
  const ai = fakeAi(() => { throw apiError(404, 'models/x is not found'); });
  await assert.rejects(generateQuiz(opts(ai)), (err) => {
    assert.equal(err.code, 'AI_MODEL_UNAVAILABLE');
    assert.match(err.userMessage, /GEMINI_MODEL/);
    assert.match(err.userMessage, /model-a, model-b/);
    return true;
  });
});

test('retries once on a transient 503 from the same model', async () => {
  const ai = fakeAi(
    () => { throw apiError(503, 'The model is overloaded. Please try again later.'); },
    () => responseWith([1, 2, 3, 4, 5].map((n) => rawQ(n)))
  );
  const quiz = await generateQuiz(opts(ai));
  assert.equal(quiz.questions.length, 5);
  assert.deepEqual(ai.calls.map((c) => c.model), ['model-a', 'model-a']);
});

test('quota errors map to AI_RATE_LIMITED / 429', async () => {
  const ai = fakeAi(() => { throw apiError(429, 'RESOURCE_EXHAUSTED: quota exceeded'); });
  await assert.rejects(generateQuiz(opts(ai)), (err) => err.code === 'AI_RATE_LIMITED' && err.httpStatus === 429);
});

test('no AI client (missing/placeholder key) -> AI_NOT_CONFIGURED', async () => {
  await assert.rejects(generateQuiz(opts(null)), (err) => err.code === 'AI_NOT_CONFIGURED' && err.httpStatus === 503);
});

test('garbage output everywhere -> AI_BAD_OUTPUT, not placeholder questions', async () => {
  const ai = fakeAi(() => ({ text: 'Sorry, I cannot help with that.' }));
  await assert.rejects(generateQuiz(opts(ai)), (err) => err instanceof QuizGenerationError);
});

test('too few usable questions -> AI_BAD_OUTPUT', async () => {
  const ai = fakeAi(() => responseWith([rawQ(1), rawQ(2, { options: ['a', 'a', 'b', 'c'] })]));
  await assert.rejects(generateQuiz(opts(ai, { count: 10 })), (err) => err.code === 'AI_BAD_OUTPUT');
});

test('returns a partial quiz (flagged) when at least half the questions are usable', async () => {
  const ai = fakeAi(() => responseWith([1, 2, 3].map((n) => rawQ(n))));
  const quiz = await generateQuiz(opts(ai, { count: 5 }));
  assert.equal(quiz.questions.length, 3);
  assert.equal(quiz.meta.partial, true);
});

test('normalizeQuestion strips A) B) prefixes and accepts letter answers', () => {
  const { question } = normalizeQuestion({
    questionText: 'What does the keyword const declare in JavaScript?',
    options: ['A) A constant binding', 'B) A mutable var', 'C) A function', 'D) A class'],
    correctAnswerIndex: 'A',
    explanation: 'const creates a block-scoped binding that cannot be reassigned.'
  });
  assert.equal(question.options[0], 'A constant binding');
  assert.equal(question.correctAnswerIndex, 0);
});

test('normalizeQuestion rejects letter-referencing and "all of the above" options', () => {
  for (const bad of ['All of the above', 'None of the above', 'Both A and B', 'Option C']) {
    const r = normalizeQuestion(rawQ(1, { options: ['x1', 'x2', 'x3', bad] }));
    assert.equal(r.reason, 'positional_option', bad);
  }
});

test('shuffleQuestion keeps the correct answer attached to its text and keeps numeric order', () => {
  const q = normalizeQuestion(rawQ(1)).question;
  for (let i = 0; i < 50; i += 1) {
    const s = shuffleQuestion(q);
    assert.equal(s.options[s.correctAnswerIndex], 'Correct answer 1');
    assert.deepEqual([...s.options].sort(), [...q.options].sort());
  }
  const numeric = { ...q, options: ['10', '20', '30', '40'], correctAnswerIndex: 2 };
  assert.deepEqual(shuffleQuestion(numeric).options, ['10', '20', '30', '40']);
});

test('parseAiJson handles arrays, fences and junk', () => {
  assert.deepEqual(parseAiJson('[{"a":1}]'), { questions: [{ a: 1 }] });
  assert.deepEqual(parseAiJson('```json\n{"x":1}\n```'), { x: 1 });
  assert.equal(parseAiJson('not json'), null);
  assert.equal(parseAiJson(''), null);
});

test('isUsableApiKey rejects placeholders but accepts real-looking keys', () => {
  assert.equal(isUsableApiKey('your_api_key_here'), false);
  assert.equal(isUsableApiKey('YOUR_GEMINI_API_KEY_GOES_HERE'), false);
  assert.equal(isUsableApiKey(''), false);
  assert.equal(isUsableApiKey(undefined), false);
  assert.equal(isUsableApiKey('<paste key>'), false);
  assert.equal(isUsableApiKey('AIzaSyD-example-0123456789abcdefghijklmn'), true);
  assert.equal(isUsableApiKey('"AIzaSyD-example-0123456789abcdefghijklmn"'), true);
});

test('resolveModels uses GEMINI_MODEL when set, otherwise current defaults', () => {
  assert.deepEqual(resolveModels('gemini-3.8-flash, gemini-3.6-flash'), ['gemini-3.8-flash', 'gemini-3.6-flash']);
  assert.deepEqual(resolveModels(''), DEFAULT_MODELS);
  assert.ok(!DEFAULT_MODELS.includes('gemini-1.5-flash'));
  assert.ok(!DEFAULT_MODELS.includes('gemini-2.0-flash'));
});
