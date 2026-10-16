# QuizForge AI

## Overview

QuizForge AI is a learning platform for generating and taking quizzes. The project uses a Node.js/Express backend and a static HTML/CSS/JavaScript frontend.

Users can:
- register and log in
- generate quizzes by topic and difficulty
- attempt quizzes and see answers
- view analytics for quiz performance

The backend supports MongoDB and has an in-memory fallback mode for development.

## Features

- AI-powered quiz generation using Google Gemini (validated, shuffled MCQs)
- user authentication and CAPTCHA verification
- email OTP verification for signup
- fallback in-memory storage when MongoDB is unavailable
- quiz analytics and anti-cheat tracking

## Repository Structure

```text
quizforge-ai/
├── backend/
│   ├── models/
│   │   ├── Analytics.js
│   │   ├── Quiz.js
│   │   └── User.js
│   ├── node_modules/
│   ├── .env.example
│   ├── package.json
│   ├── package-lock.json
│   └── server.js
├── frontend/
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   ├── app.js
│   │   ├── login.js
│   │   ├── quiz-player.js
│   │   └── signup.js
│   ├── index.html
│   ├── login.html
│   ├── quiz.html
│   └── signup.html
├── .gitignore
└── README.md
```

## Getting Started

### Prerequisites

- Node.js v20 or later (v22 tested)
- npm
- Optional: MongoDB if you want persistent storage
- Optional: Google Gemini API key for real AI generation

### Backend Setup

1. Install dependencies:

```bash
cd backend
npm install
```

2. Copy the environment example and update values:

```bash
copy .env.example .env
```

3. Start the backend:

```bash
npm run dev
```

The backend listens on `http://localhost:5001` by default.

### Frontend Setup

Open `frontend/index.html` directly in a browser, or run a static server:

```bash
cd frontend
npx serve
```

Then navigate to the URL shown by the server.

## Environment Variables

Use `backend/.env` to configure the backend.

Example:

```env
PORT=5001
MONGO_URI=mongodb://localhost:27017/quizforge
GEMINI_API_KEY=your_api_key_here
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=you@example.com
SMTP_PASS=yourpassword
```

`GEMINI_API_KEY` is **required** for quiz generation. If it is missing or still the
placeholder, the app shows a clear error instead of fake questions.

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Key from https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | Optional, comma-separated, first is preferred. Default: `gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite,gemini-2.5-flash` |
| `GEMINI_TIMEOUT_MS` | Optional per-request timeout (default 90000) |

Google retires models often (`gemini-1.5-flash` and `gemini-2.0-flash` are already
shut down). Current list: https://ai.google.dev/gemini-api/docs/deprecations

On Render/hosting, set these as environment variables in the dashboard (`.env` is git-ignored).

## Verify your setup

```bash
cd backend
npm run check:ai   # calls Gemini for real and tells you exactly what is wrong
npm test           # offline unit + end-to-end tests (fake Gemini server)
```

## Troubleshooting

- **"AI quiz generation is not configured"**: add a real `GEMINI_API_KEY` to `backend/.env`, restart.
- **"Gemini rejected the API key"**: key is wrong/expired/restricted.
- **"None of the configured Gemini models are available"**: set `GEMINI_MODEL` to a current model.
- **Sent back to login unexpectedly**: without MongoDB, sessions live in memory and reset on every server restart.

## GitHub Repository

This project can be pushed to the following remote repository:

`https://github.com/VedpathakRohan/QuizForge-AI.git`

## Notes

- The frontend is static HTML/JS and communicates with the backend API.
- The backend handles authentication, CAPTCHA generation, quiz creation, and analytics.
- For production deployment, make sure to secure environment variables and use a real SMTP provider.

## License

MIT
