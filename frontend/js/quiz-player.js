/**
 * QuizForge AI - Active Quiz Player Engine
 * Orchestrates stopwatch logic, security visibility monitoring, choice validation,
 * dynamic element creation, responsive feedback layouts, and DB logging.
 */

const API_BASE_URL = '/api';

document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('quizforge_auth_token');
  if (!token) {
    window.location.href = 'login.html';
    return;
  }

  // Load cached assessment from local storage
  const cachedQuizRaw = localStorage.getItem('quizforge_current_quiz');
  if (!cachedQuizRaw) {
    alert('No active quiz found in session. Returning to dashboard.');
    window.location.href = 'index.html';
    return;
  }

  let quiz;
  try {
    quiz = JSON.parse(cachedQuizRaw);
  } catch (err) {
    console.error('Failed to parse cached quiz:', err);
    window.location.href = 'index.html';
    return;
  }

  // --- Game Loop States ---
  let currentIndex = 0;
  let score = 0;
  let timeSpentSeconds = 0;
  let antiCheatViolations = 0;
  let isAnswered = false;
  let timerInterval = null;

  // --- DOM Element Queries ---
  const quizTitleDisplay = document.getElementById('quiz-title-display');
  const quizTopicBadge = document.getElementById('quiz-topic-badge');
  const quizDiffBadge = document.getElementById('quiz-diff-badge');
  
  const playerTimer = document.getElementById('player-timer');
  const cheatCount = document.getElementById('cheat-count');
  const playerScoreDisplay = document.getElementById('player-score-display');
  const quizProgressIndicator = document.getElementById('quiz-progress-indicator');
  
  const questionIndexDisplay = document.getElementById('question-index-display');
  const questionTextDisplay = document.getElementById('question-text-display');
  const optionsMatrix = document.getElementById('options-matrix');
  
  const feedbackDrawer = document.getElementById('feedback-drawer');
  const feedbackStatusBadge = document.getElementById('feedback-status-badge');
  const feedbackStatusIcon = document.getElementById('feedback-status-icon');
  const feedbackStatusText = document.getElementById('feedback-status-text');
  const explanationTextDisplay = document.getElementById('explanation-text-display');
  
  const nextQuestionBtn = document.getElementById('next-question-btn');
  const nextBtnLabel = document.getElementById('next-btn-label');
  
  const summaryModal = document.getElementById('summary-modal');
  const summaryAccuracy = document.getElementById('summary-accuracy');
  const summaryRawScore = document.getElementById('summary-raw-score');
  const summaryDuration = document.getElementById('summary-duration');
  const summaryCheats = document.getElementById('summary-cheats');
  const summaryIntegrityStatus = document.getElementById('summary-integrity-status');
  const finishAndExitBtn = document.getElementById('finish-and-exit-btn');

  /**
   * Helper utility to escape HTML content and prevent XSS injections.
   */
  function escapeHTML(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Formats raw seconds into an MM:SS visual format.
   */
  function formatStopwatch(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Starts the assessment timer stopwatch.
   */
  function startStopwatch() {
    timerInterval = setInterval(() => {
      timeSpentSeconds++;
      playerTimer.textContent = formatStopwatch(timeSpentSeconds);
    }, 1000);
  }

  /**
   * Page Visibility API implementation to capture window switches and cheats.
   */
  function initSecurityMonitor() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        antiCheatViolations++;
        cheatCount.textContent = antiCheatViolations;
        
        // Custom micro-interaction styling warning
        const securityStatusBox = document.querySelector('.security-status');
        if (securityStatusBox) {
          securityStatusBox.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
          securityStatusBox.style.borderColor = 'var(--danger)';
          setTimeout(() => {
            securityStatusBox.style.backgroundColor = 'rgba(0, 0, 0, 0.2)';
            securityStatusBox.style.borderColor = 'rgba(245, 158, 11, 0.25)';
          }, 3000);
        }

        // System prompt alerting user of the violation
        alert('SECURITY PROTOCOL WARNING:\n\nSwitched windows/tabs detected. Any focus shift is recorded on the server metrics. Keep focus on this window to maintain integrity verification.');
      }
    });
  }

  /**
   * Renders the active question card, letters, options, and progress trackers.
   */
  function displayQuestion() {
    isAnswered = false;
    
    // Hide feedback drawer
    feedbackDrawer.classList.add('hidden');
    
    const activeQuestion = quiz.questions[currentIndex];
    
    // Update labels and progress percentages
    const totalQuestions = quiz.questions.length;
    questionIndexDisplay.textContent = `Question ${currentIndex + 1} of ${totalQuestions}`;
    playerScoreDisplay.textContent = `${score} / ${totalQuestions}`;
    
    // Animate progress bar fill width
    const progressPercent = (currentIndex / totalQuestions) * 100;
    quizProgressIndicator.style.width = `${progressPercent}%`;

    // Render text
    questionTextDisplay.textContent = activeQuestion.questionText;

    // Dynamically build choice option buttons in option grid
    optionsMatrix.innerHTML = '';
    activeQuestion.options.forEach((option, idx) => {
      const optionBtn = document.createElement('button');
      optionBtn.className = 'choice-option-btn glass-panel';
      optionBtn.setAttribute('data-index', idx);
      optionBtn.setAttribute('aria-label', `Option ${String.fromCharCode(65 + idx)}: ${option}`);
      
      optionBtn.innerHTML = `
        <span class="choice-letter" aria-hidden="true">${String.fromCharCode(65 + idx)}</span>
        <span class="choice-text">${escapeHTML(option)}</span>
      `;
      
      // Wire selection listener
      optionBtn.addEventListener('click', handleChoiceSelection);
      optionsMatrix.appendChild(optionBtn);
    });
  }

  /**
   * Evaluates chosen response, formats success/error cards, and opens feedback drawers.
   */
  function handleChoiceSelection(e) {
    if (isAnswered) return;
    isAnswered = true;

    const selectedBtn = e.currentTarget;
    const selectedIndex = parseInt(selectedBtn.getAttribute('data-index'), 10);
    const activeQuestion = quiz.questions[currentIndex];
    const correctIndex = activeQuestion.correctAnswerIndex;

    // Disable all options to prevent multi-click exploits
    const allOptionBtns = optionsMatrix.querySelectorAll('.choice-option-btn');
    allOptionBtns.forEach(btn => btn.disabled = true);

    // Clear badge classes
    feedbackStatusBadge.className = 'feedback-result-badge';

    if (selectedIndex === correctIndex) {
      // Correct outcome
      score++;
      selectedBtn.classList.add('correct-choice');
      feedbackStatusBadge.classList.add('badge-success');
      feedbackStatusText.textContent = 'Correct Response';
      feedbackStatusIcon.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      `;
    } else {
      // Incorrect outcome
      selectedBtn.classList.add('incorrect-choice');
      feedbackStatusBadge.classList.add('badge-danger');
      feedbackStatusText.textContent = 'Incorrect Response';
      feedbackStatusIcon.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      `;
      
      // Highlight the correct answer index as an educational aid
      const correctBtn = optionsMatrix.querySelector(`[data-index="${correctIndex}"]`);
      if (correctBtn) {
        correctBtn.classList.add('correct-choice');
      }
    }

    // Refresh display indicators
    const totalQuestions = quiz.questions.length;
    playerScoreDisplay.textContent = `${score} / ${totalQuestions}`;

    // Pop academic description drawer
    explanationTextDisplay.textContent = activeQuestion.explanation;

    // Toggle CTA labels based on remaining questions
    if (currentIndex === totalQuestions - 1) {
      nextBtnLabel.textContent = 'Finish Assessment';
    } else {
      nextBtnLabel.textContent = 'Next Question';
    }

    feedbackDrawer.classList.remove('hidden');
  }

  /**
   * Advances current question state or terminates assessment.
   */
  nextQuestionBtn.addEventListener('click', () => {
    const totalQuestions = quiz.questions.length;
    if (currentIndex < totalQuestions - 1) {
      currentIndex++;
      displayQuestion();
    } else {
      terminateQuiz();
    }
  });

  /**
   * Stops timer stopwatches, compiles data payloads, and shows the terminal report.
   */
  function terminateQuiz() {
    clearInterval(timerInterval);
    
    // Complete visual progress bar track
    quizProgressIndicator.style.width = '100%';

    const totalQuestions = quiz.questions.length;
    const accuracy = Math.round((score / totalQuestions) * 100);
    
    // Set score values in final modal card
    summaryAccuracy.textContent = `${accuracy}%`;
    summaryRawScore.textContent = `${score} / ${totalQuestions}`;
    summaryDuration.textContent = formatStopwatch(timeSpentSeconds);
    summaryCheats.textContent = `${antiCheatViolations} Violation${antiCheatViolations === 1 ? '' : 's'}`;

    // Configure Academic Integrity indicator label
    if (antiCheatViolations === 0) {
      summaryIntegrityStatus.textContent = 'Verified Integrity ✔';
      summaryIntegrityStatus.style.color = 'var(--success)';
    } else {
      summaryIntegrityStatus.textContent = 'Compromised ✖';
      summaryIntegrityStatus.style.color = 'var(--danger)';
    }

    // Display summary overlay card
    summaryModal.setAttribute('aria-hidden', 'false');
  }

  /**
   * Posts final score analytics payload to Express endpoint and clean local session.
   */
  finishAndExitBtn.addEventListener('click', async () => {
    // Disable exit buttons to block duplicate requests
    finishAndExitBtn.disabled = true;
    finishAndExitBtn.querySelector('.btn-text').textContent = 'Syncing Scores...';

    const totalQuestions = quiz.questions.length;

    const payload = {
      quizId: quiz._id,
      finalScore: score,
      totalQuestions: totalQuestions,
      timeSpentSeconds: timeSpentSeconds,
      antiCheatViolations: antiCheatViolations
    };

    try {
      const response = await fetch(`${API_BASE_URL}/quiz/analytics`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error('Database server failed to record performance telemetry.');
      }

      console.log('Analytics saved successfully. Cleared session cache.');
    } catch (err) {
      console.error('Failed to sync scores with database:', err);
      alert('Network warning: Failed to sync scores online. Local score cache was generated.');
    } finally {
      // Clean up cached structures and route back home
      localStorage.removeItem('quizforge_current_quiz');
      window.location.href = 'index.html';
    }
  });

  // --- Initializers ---
  quizTitleDisplay.textContent = quiz.title;
  quizTopicBadge.textContent = quiz.topic;
  quizDiffBadge.textContent = quiz.difficulty;
  
  // Apply badge difficulty colors
  quizDiffBadge.classList.add(`${quiz.difficulty}-badge`);

  startStopwatch();
  initSecurityMonitor();
  displayQuestion();
});
