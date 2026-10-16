import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import Quiz from './models/Quiz.js';
import Analytics from './models/Analytics.js';
import User from './models/User.js';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import {
  generateQuiz,
  resolveModels,
  isUsableApiKey,
  QuizGenerationError
} from './services/quizGenerator.js';

// Load environment configurations
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendPath = path.join(__dirname, '../frontend');

const app = express();
const PORT = process.env.PORT || 5001;

// Initialize Google Gen AI client using official SDK.
// Placeholder values such as "your_api_key_here" are treated as "not configured"
// so we never pretend to have an AI while actually serving fake questions.
const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim().replace(/^['"]|['"]$/g, '').trim();
const hasGeminiApiKey = isUsableApiKey(geminiApiKey);
const geminiModels = resolveModels(process.env.GEMINI_MODEL);
const GEMINI_TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS, 10) || 90000;
const ai = hasGeminiApiKey
  ? new GoogleGenAI({ apiKey: geminiApiKey, httpOptions: { timeout: GEMINI_TIMEOUT_MS } })
  : null;

if (hasGeminiApiKey) {
  console.log(`[AI] Gemini configured. Models (in order): ${geminiModels.join(', ')}`);
} else {
  console.warn('[AI] GEMINI_API_KEY is missing or still a placeholder. Quiz generation will return an error until a real key is set in backend/.env.');
}

// In-Memory cache storage when MongoDB database is offline
const inMemoryQuizzes = new Map();
const inMemoryAnalytics = [];
const inMemoryUsers = new Map();
const inMemorySessions = new Map(); // token -> user object

// Temporary registration OTP cache
const pendingRegistrations = new Map(); // email -> { name, passwordHash, salt, otp, expiresAt }

// Captcha Verification Map
const activeCaptchas = new Map();

// Configure nodemailer transport
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || '',
  port: parseInt(process.env.SMTP_PORT, 10) || 587,
  secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  }
});

// Helper to send registration OTP email
async function sendOtpEmail(email, otp) {
  console.log(`[OTP DISPATCH] Attempting to send OTP email to ${email}...`);
  console.log(`[OTP FALLBACK CODE] >>> ${otp} <<<`);

  const isSmtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  if (!isSmtpConfigured) {
    console.log('[OTP DISPATCH] SMTP credentials missing. Using local terminal console fallback.');
    return false;
  }

  try {
    await transporter.sendMail({
      from: `"QuizForge AI" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Verify Your QuizForge AI Account',
      text: `Your 6-digit verification code is: ${otp}. This code expires in 10 minutes.`,
      html: `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; background: #ffffff;">
          <h2 style="color: #2563eb; margin-top: 0; font-family: 'Plus Jakarta Sans', sans-serif;">QuizForge AI Verification</h2>
          <p>Thank you for registering. Please enter the following 6-digit verification code to complete your signup:</p>
          <div style="background: #eff6ff; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 4px; border-radius: 6px; margin: 20px 0; border: 1px solid rgba(37,99,235,0.15); color: #2563eb;">
            ${otp}
          </div>
          <p style="font-size: 12px; color: #64748b; margin-bottom: 0;">This code is valid for 10 minutes. If you did not request this, please ignore this email.</p>
        </div>
      `
    });
    console.log(`[OTP DISPATCH] Verification email successfully sent to ${email}.`);
    return true;
  } catch (err) {
    console.error(`[OTP DISPATCH ERROR] Failed to send email to ${email}:`, err.message);
    return false;
  }
}

// Distorted SVG CAPTCHA generator
function generateCaptcha() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let captchaText = '';
  for (let i = 0; i < 4; i++) {
    captchaText += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40">
    <rect width="100%" height="100%" fill="#f8fafc" rx="8" stroke="#e2e8f0" stroke-width="1"/>
    <line x1="0" y1="18" x2="120" y2="22" stroke="#cbd5e1" stroke-width="2"/>
    <line x1="12" y1="32" x2="108" y2="8" stroke="#cbd5e1" stroke-width="1.5"/>
    <text x="20" y="28" font-family="monospace, Courier New" font-size="22" font-weight="bold" fill="#2563eb" letter-spacing="6" transform="rotate(-2, 60, 20)">${captchaText}</text>
  </svg>`;
  
  return { text: captchaText, svg };
}

// Configure Middleware
app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(frontendPath));
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});
app.get('*', (req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(frontendPath, 'index.html'));
  }
  next();
});

// Log incoming API calls
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Connect to MongoDB
const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/quizforge';
mongoose
  .connect(mongoUri, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log('Successfully connected to MongoDB.'))
  .catch((err) => {
    console.warn('MongoDB connection failure. Switching to IN-MEMORY DATABASE FALLBACK MODE:', err.message);
  });

// Authentication Middleware
const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.warn('Auth failed: Missing or invalid token format');
      return res.status(401).json({ success: false, error: 'Unauthorized: Missing or invalid token format.' });
    }

    const token = authHeader.split(' ')[1];
    let user = null;

    if (mongoose.connection.readyState === 1) {
      console.log('MongoDB connected - querying database for token');
      user = await User.findOne({ sessionToken: token });
    } else {
      console.log('MongoDB offline - checking in-memory sessions');
      user = inMemorySessions.get(token);
      if (!user) {
        console.warn(`Token not found in in-memory sessions. Available tokens: ${Array.from(inMemorySessions.keys()).length}`);
      }
    }

    if (!user) {
      console.warn(`Auth failed: No user found for token: ${token.substring(0, 10)}...`);
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid session token. Please log in again.' });
    }

    console.log(`Auth successful for user: ${user.email}`);
    req.user = user;
    next();
  } catch (err) {
    console.error('Authentication error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error during authentication.' });
  }
};

// --- HEALTH CHECK ENDPOINT ---

/**
 * GET /api/health
 * Returns server and database status
 */
app.get('/api/health', (req, res) => {
  const mongoStatus = mongoose.connection.readyState;
  const statusMap = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };
  
  res.json({
    success: true,
    status: 'operational',
    database: statusMap[mongoStatus],
    mongoConnected: mongoStatus === 1,
    timestamp: new Date().toISOString(),
    inMemorySessions: inMemorySessions.size,
    inMemoryUsers: inMemoryUsers.size,
    ai: {
      configured: hasGeminiApiKey,
      models: geminiModels
    }
  });
});

// --- AUTHENTICATION & CAPTCHA ENDPOINTS ---

/**
 * GET /api/auth/captcha
 * Generates an SVG captcha and caches its answer.
 */
app.get('/api/auth/captcha', (req, res) => {
  const { text, svg } = generateCaptcha();
  const captchaId = Math.random().toString(36).substring(2, 9);
  activeCaptchas.set(captchaId, text.toLowerCase());
  
  // Expiry captcha after 5 minutes
  setTimeout(() => activeCaptchas.delete(captchaId), 5 * 60 * 1000);
  
  return res.json({ success: true, captchaId, svg });
});

/**
 * POST /api/auth/signup
 * Payload: { name, email, password, captchaId, captchaAnswer }
 */
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password, captchaId, captchaAnswer } = req.body;

    if (!name || !email || !password || !captchaId || !captchaAnswer) {
      return res.status(400).json({ success: false, error: 'All fields including CAPTCHA are required.' });
    }

    // Verify CAPTCHA
    const correctCaptcha = activeCaptchas.get(captchaId);
    if (!correctCaptcha || correctCaptcha !== captchaAnswer.trim().toLowerCase()) {
      return res.status(400).json({ success: false, error: 'CAPTCHA check failed. Please try again.' });
    }
    activeCaptchas.delete(captchaId); // Avoid replay reuse

    const lowerEmail = email.toLowerCase().trim();

    // Check for existing user
    let userExists = false;
    if (mongoose.connection.readyState === 1) {
      userExists = await User.findOne({ email: lowerEmail });
    } else {
      userExists = inMemoryUsers.has(lowerEmail);
    }

    if (userExists) {
      return res.status(400).json({ success: false, error: 'An account with this email already exists.' });
    }

    // Generate 6-digit OTP code and hash password details immediately
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    let salt, hash;
    if (mongoose.connection.readyState === 1) {
      const hashDetails = User.hashPassword(password);
      salt = hashDetails.salt;
      hash = hashDetails.hash;
    } else {
      salt = crypto.randomBytes(16).toString('hex');
      hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    }

    // Cache pending credentials
    pendingRegistrations.set(lowerEmail, {
      name,
      passwordHash: hash,
      salt,
      otp,
      expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes expiry
    });

    // Send OTP verification email
    const emailSent = await sendOtpEmail(lowerEmail, otp);
    const isSmtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

    // SMTP is set up but the mail failed: never hand the code back to the browser,
    // that would let anyone "verify" an email address they do not own.
    if (isSmtpConfigured && !emailSent) {
      return res.status(502).json({
        success: false,
        error: 'We could not send the verification email right now. Please try again in a few minutes.'
      });
    }

    // Local/dev mode (no SMTP configured): expose the code so signup still works.
    const showOtp = !isSmtpConfigured;

    return res.status(200).json({
      success: true,
      message: 'Verification OTP code successfully sent to your email.',
      email: lowerEmail,
      devOtp: showOtp ? otp : undefined,
      emailSent
    });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ success: false, error: 'An error occurred during registration.' });
  }
});

/**
 * POST /api/auth/verify-otp
 * Payload: { email, otp }
 */
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, error: 'Email and verification OTP are required.' });
    }

    const lowerEmail = email.toLowerCase().trim();
    const pending = pendingRegistrations.get(lowerEmail);

    if (!pending) {
      return res.status(400).json({ success: false, error: 'No pending registration request found for this email.' });
    }

    if (pending.expiresAt < Date.now()) {
      pendingRegistrations.delete(lowerEmail);
      return res.status(400).json({ success: false, error: 'Verification code has expired. Please sign up again.' });
    }

    if (pending.otp !== otp.trim()) {
      return res.status(400).json({ success: false, error: 'Invalid verification OTP code.' });
    }

    // OTP matches! Build user
    let userRecord;
    const token = crypto.randomBytes(32).toString('hex');

    if (mongoose.connection.readyState === 1) {
      const newUser = new User({
        name: pending.name,
        email: lowerEmail,
        passwordHash: pending.passwordHash,
        salt: pending.salt,
        sessionToken: token
      });
      await newUser.save();
      userRecord = newUser;
    } else {
      const mockId = new mongoose.Types.ObjectId();
      userRecord = {
        _id: mockId,
        name: pending.name,
        email: lowerEmail,
        passwordHash: pending.passwordHash,
        salt: pending.salt,
        sessionToken: token
      };
      inMemoryUsers.set(lowerEmail, userRecord);
      inMemorySessions.set(token, userRecord);
    }

    // Clean up cache
    pendingRegistrations.delete(lowerEmail);

    return res.status(201).json({
      success: true,
      message: 'Account successfully registered and verified.',
      token,
      user: {
        name: userRecord.name,
        email: userRecord.email
      }
    });
  } catch (err) {
    console.error('Verify OTP error:', err);
    return res.status(500).json({ success: false, error: 'An error occurred during verification.' });
  }
});

/**
 * POST /api/auth/resend-otp
 * Payload: { email }
 */
app.post('/api/auth/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required.' });
    }

    const lowerEmail = email.toLowerCase().trim();
    const pending = pendingRegistrations.get(lowerEmail);

    if (!pending) {
      return res.status(400).json({ success: false, error: 'No pending registration request found for this email.' });
    }

    const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
    pending.otp = newOtp;
    pending.expiresAt = Date.now() + 10 * 60 * 1000;

    const emailSent = await sendOtpEmail(lowerEmail, newOtp);
    const isSmtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

    if (isSmtpConfigured && !emailSent) {
      return res.status(502).json({
        success: false,
        error: 'We could not send the verification email right now. Please try again in a few minutes.'
      });
    }
    const showOtp = !isSmtpConfigured;

    return res.json({
      success: true,
      message: 'A new 6-digit verification code has been dispatched.',
      devOtp: showOtp ? newOtp : undefined,
      emailSent
    });
  } catch (err) {
    console.error('Resend OTP error:', err);
    return res.status(500).json({ success: false, error: 'An error occurred while resending code.' });
  }
});

/**
 * POST /api/auth/login
 * Payload: { email, password, captchaId, captchaAnswer }
 */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, captchaId, captchaAnswer } = req.body;

    if (!email || !password || !captchaId || !captchaAnswer) {
      return res.status(400).json({ success: false, error: 'All fields including CAPTCHA are required.' });
    }

    // Verify CAPTCHA
    const correctCaptcha = activeCaptchas.get(captchaId);
    if (!correctCaptcha || correctCaptcha !== captchaAnswer.trim().toLowerCase()) {
      return res.status(400).json({ success: false, error: 'CAPTCHA check failed. Please try again.' });
    }
    activeCaptchas.delete(captchaId);

    const lowerEmail = email.toLowerCase().trim();
    let user = null;

    if (mongoose.connection.readyState === 1) {
      user = await User.findOne({ email: lowerEmail });
    } else {
      user = inMemoryUsers.get(lowerEmail);
    }

    if (!user) {
      return res.status(400).json({ success: false, error: 'Invalid email or password.' });
    }

    // Verify password
    let passwordMatches = false;
    if (mongoose.connection.readyState === 1) {
      passwordMatches = user.verifyPassword(password);
    } else {
      const checkHash = crypto.pbkdf2Sync(password, user.salt, 1000, 64, 'sha512').toString('hex');
      passwordMatches = user.passwordHash === checkHash;
    }

    if (!passwordMatches) {
      return res.status(400).json({ success: false, error: 'Invalid email or password.' });
    }

    // Generate session token
    const token = crypto.randomBytes(32).toString('hex');
    if (mongoose.connection.readyState === 1) {
      user.sessionToken = token;
      await user.save();
    } else {
      user.sessionToken = token;
      inMemorySessions.set(token, user);
    }

    return res.json({
      success: true,
      token,
      user: {
        name: user.name,
        email: user.email
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, error: 'An error occurred during login.' });
  }
});

/**
 * Cleans the user-supplied topic: strips control characters, collapses whitespace
 * and caps the length so it cannot be abused to bloat or hijack the AI prompt.
 */
function sanitizeTopic(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * POST /api/quiz/generate
 * Payload: { topic: string, difficulty: 'easy'|'medium'|'hard', count?: 3-30 }
 * Asks Gemini for real multiple-choice questions, validates every one of them
 * and responds with an error (never with fake placeholder questions) if the AI
 * cannot deliver. See services/quizGenerator.js.
 */
app.post('/api/quiz/generate', authenticateUser, async (req, res) => {
  try {
    const { difficulty, count = 10 } = req.body || {};
    const topic = sanitizeTopic(req.body?.topic);

    if (!topic || typeof difficulty !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Parameters "topic" and "difficulty" are required.'
      });
    }

    const normalizedDifficulty = difficulty.toLowerCase().trim();
    if (!['easy', 'medium', 'hard'].includes(normalizedDifficulty)) {
      return res.status(400).json({
        success: false,
        error: 'Difficulty must be one of: easy, medium, hard.'
      });
    }

    let parsedCount = parseInt(count, 10);
    if (Number.isNaN(parsedCount) || parsedCount < 3 || parsedCount > 30) {
      parsedCount = 10;
    }

    console.log(`Generating quiz: Topic="${topic}", Difficulty="${normalizedDifficulty}", Count=${parsedCount}`);

    const quizData = await generateQuiz({
      ai,
      topic,
      difficulty: normalizedDifficulty,
      count: parsedCount,
      models: geminiModels
    });
    const { meta, ...quizFields } = quizData;
    console.log(`[quiz] Generated ${meta.generated}/${meta.requested} questions with ${meta.model}`);

    let savedQuiz;
    if (mongoose.connection.readyState === 1) {
      quizFields.createdBy = req.user._id;
      const newQuiz = new Quiz(quizFields);
      await newQuiz.save();
      savedQuiz = newQuiz;
      console.log(`Quiz successfully saved to MongoDB. ID: ${savedQuiz._id}`);
    } else {
      const mockId = new mongoose.Types.ObjectId();
      quizFields._id = mockId;
      quizFields.createdBy = req.user._id.toString();
      inMemoryQuizzes.set(mockId.toString(), quizFields);
      savedQuiz = quizFields;
      console.log(`[IN-MEMORY MODE] Quiz saved in cache. ID: ${mockId}`);
    }

    return res.status(201).json({
      success: true,
      quiz: savedQuiz,
      meta
    });
  } catch (err) {
    if (err instanceof QuizGenerationError) {
      console.error(`[quiz] ${err.code}: ${err.userMessage}`, err.details || '');
      return res.status(err.httpStatus).json({
        success: false,
        code: err.code,
        error: err.userMessage,
        details: err.details
      });
    }

    console.error('Error in /api/quiz/generate:', err);
    return res.status(500).json({
      success: false,
      error: 'Assessment generation failed unexpectedly. Please try again.',
      details: err.message,
      diagnostics: {
        mongoStatus: mongoose.connection.readyState === 1 ? 'connected' : 'offline',
        geminiConfigured: hasGeminiApiKey,
        timestamp: new Date().toISOString()
      }
    });
  }
});

/**
 * POST /api/quiz/analytics
 * Payload format: { quizId: string, finalScore: number, totalQuestions: number, timeSpentSeconds: number, antiCheatViolations: number }
 * Calculates accuracy and persists performance stats in DB.
 */
app.post('/api/quiz/analytics', authenticateUser, async (req, res) => {
  try {
    const { quizId, finalScore, totalQuestions, timeSpentSeconds, antiCheatViolations } = req.body;

    if (!quizId || finalScore === undefined || !totalQuestions || timeSpentSeconds === undefined || antiCheatViolations === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required analytics fields in request body.'
      });
    }

    // Reject nonsense numbers (e.g. score > total) before they reach the database
    const isCount = (n) => Number.isInteger(n) && n >= 0;
    if (!isCount(finalScore) || !isCount(totalQuestions) || totalQuestions < 1 ||
        finalScore > totalQuestions || !isCount(antiCheatViolations) ||
        typeof timeSpentSeconds !== 'number' || !Number.isFinite(timeSpentSeconds) || timeSpentSeconds < 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid analytics values: score must be between 0 and the number of questions.'
      });
    }

    // Validate if the quiz exists
    let quizRecord = null;
    if (mongoose.connection.readyState === 1) {
      if (!mongoose.isValidObjectId(quizId)) {
        return res.status(404).json({ success: false, error: 'The referenced quiz ID does not exist.' });
      }
      quizRecord = await Quiz.findById(quizId);
    } else {
      quizRecord = inMemoryQuizzes.get(String(quizId)) || null;
    }

    if (!quizRecord) {
      return res.status(404).json({
        success: false,
        error: 'The referenced quiz ID does not exist.'
      });
    }

    if (Array.isArray(quizRecord.questions) && quizRecord.questions.length !== totalQuestions) {
      return res.status(400).json({
        success: false,
        error: 'totalQuestions does not match the quiz that was taken.'
      });
    }

    // Calculate user accuracy percentage
    const userAccuracy = Math.round((finalScore / totalQuestions) * 100);

    const logEntry = {
      quizId,
      finalScore,
      totalQuestions,
      userAccuracy,
      timeSpentSeconds,
      antiCheatViolations,
      userId: req.user._id,
      createdAt: new Date()
    };

    if (mongoose.connection.readyState === 1) {
      const dbEntry = new Analytics(logEntry);
      await dbEntry.save();
      console.log(`Analytics successfully logged to MongoDB. Log ID: ${dbEntry._id}`);
    } else {
      logEntry.userId = req.user._id.toString();
      inMemoryAnalytics.push(logEntry);
      console.log(`[IN-MEMORY MODE] Analytics logged to cache. Total logs: ${inMemoryAnalytics.length}`);
    }

    return res.status(201).json({
      success: true,
      message: 'Student score analytics successfully persisted.',
      analytics: logEntry
    });
  } catch (err) {
    console.error('Error logging /api/quiz/analytics:', err);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while saving academic performance data.'
    });
  }
});

/**
 * GET /api/quiz/stats
 * Fetches dashboard aggregates including:
 * - Total quizzes generated
 * - Total quizzes completed (taken)
 * - Average score accuracy
 * - Total anti-cheat violations caught
 * - Academic integrity rate (% of quizzes completed with 0 violations)
 */
app.get('/api/quiz/stats', authenticateUser, async (req, res) => {
  try {
    let totalGenerated = 0;
    let totalTaken = 0;
    let averageAccuracy = 0;
    let totalCheatViolations = 0;
    let integrityRate = 100;

    const userObjId = req.user._id;
    const userStrId = req.user._id.toString();

    if (mongoose.connection.readyState === 1) {
      totalGenerated = await Quiz.countDocuments({ createdBy: userObjId });
      totalTaken = await Analytics.countDocuments({ userId: userObjId });

      if (totalTaken > 0) {
        // Calculate average accuracy
        const accuracyAgg = await Analytics.aggregate([
          { $match: { userId: userObjId } },
          { $group: { _id: null, avgAccuracy: { $avg: '$userAccuracy' } } }
        ]);
        averageAccuracy = accuracyAgg[0] ? Math.round(accuracyAgg[0].avgAccuracy) : 0;

        // Sum total violations
        const violationsAgg = await Analytics.aggregate([
          { $match: { userId: userObjId } },
          { $group: { _id: null, sumViolations: { $sum: '$antiCheatViolations' } } }
        ]);
        totalCheatViolations = violationsAgg[0] ? violationsAgg[0].sumViolations : 0;

        // Calculate number of quizzes with 0 violations
        const cleanIntegrityQuizzesCount = await Analytics.countDocuments({ userId: userObjId, antiCheatViolations: 0 });
        integrityRate = Math.round((cleanIntegrityQuizzesCount / totalTaken) * 100);
      }
    } else {
      // Calculate from in-memory arrays scoped to user
      totalGenerated = Array.from(inMemoryQuizzes.values()).filter(q => q.createdBy === userStrId).length;
      const userAnalytics = inMemoryAnalytics.filter(item => item.userId === userStrId);
      totalTaken = userAnalytics.length;

      if (totalTaken > 0) {
        const sumAccuracy = userAnalytics.reduce((sum, item) => sum + item.userAccuracy, 0);
        averageAccuracy = Math.round(sumAccuracy / totalTaken);

        totalCheatViolations = userAnalytics.reduce((sum, item) => sum + item.antiCheatViolations, 0);

        const cleanIntegrityCount = userAnalytics.filter(item => item.antiCheatViolations === 0).length;
        integrityRate = Math.round((cleanIntegrityCount / totalTaken) * 100);
      }
    }

    return res.status(200).json({
      success: true,
      stats: {
        totalGenerated,
        totalTaken,
        averageAccuracy,
        totalCheatViolations,
        integrityRate
      }
    });
  } catch (err) {
    console.error('Error fetching global stats:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve aggregated dashboard platform statistics.'
    });
  }
});

// Start listening for API traffic
const server = app.listen(PORT, () => {
  console.log(`QuizForge AI Backend listening at http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Please stop the other process or set a different PORT in backend/.env.`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});
