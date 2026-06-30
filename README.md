<<<<<<< HEAD
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

- AI-powered quiz generation using Google Gemini
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

- Node.js v20 or later
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

If `GEMINI_API_KEY` is not provided, the backend will use a built-in fallback quiz generator.

## GitHub Repository

This project can be pushed to the following remote repository:

`https://github.com/VedpathakRohan/QuizForge-AI.git`

## Notes

- The frontend is static HTML/JS and communicates with the backend API.
- The backend handles authentication, CAPTCHA generation, quiz creation, and analytics.
- For production deployment, make sure to secure environment variables and use a real SMTP provider.

## License

MIT
