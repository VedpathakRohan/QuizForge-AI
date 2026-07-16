/**
 * QuizForge AI - Dashboard & Assessment Generator Controller
 * Manages stats population, tags keywords manager, question length, form submissions, and modal blurs.
 */

const API_BASE_URL = '/api';

document.addEventListener('DOMContentLoaded', () => {
  // --- AUTHENTICATION GUARD & HEADER SETUP ---
  const token = localStorage.getItem('quizforge_auth_token');
  if (!token) {
    window.location.href = 'login.html';
    return;
  }

  // Set logged in user info
  const userName = localStorage.getItem('quizforge_user_name') || 'Guest User';
  const displayUserName = document.getElementById('display-user-name');
  const userAvatarInitials = document.getElementById('user-avatar-initials');
  const logoutBtn = document.getElementById('logout-btn');

  if (displayUserName) displayUserName.textContent = userName;
  if (userAvatarInitials) {
    const initials = userName
      .split(' ')
      .map(n => n.charAt(0))
      .join('')
      .toUpperCase()
      .substring(0, 2);
    userAvatarInitials.textContent = initials || 'U';
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('quizforge_auth_token');
      localStorage.removeItem('quizforge_user_name');
      localStorage.removeItem('quizforge_user_email');
      window.location.href = 'login.html';
    });
  }

  // Pull DOM element references
  const statsTotalGenerated = document.getElementById('stat-total-generated');
  const statsTotalTaken = document.getElementById('stat-total-taken');
  const statsAvgAccuracy = document.getElementById('stat-avg-accuracy');
  const statsIntegrityRate = document.getElementById('stat-integrity-rate');

  const configForm = document.getElementById('quiz-config-form');
  const loadingModal = document.getElementById('loading-modal');
  const modalTitle = document.getElementById('loading-status-title');
  const modalDesc = document.getElementById('loading-status-desc');
  const progressBarFill = document.getElementById('modal-progress-bar');
  const progressPercentage = document.getElementById('modal-progress-pct');

  /**
   * Keywords / Tags manager for Topic input field
   */
  const tagsList = document.getElementById('tags-list');
  const topicInputField = document.getElementById('quiz-topic-input');
  const hiddenTopicInput = document.getElementById('quiz-topic');
  let tags = [];

  function updateTags() {
    tagsList.innerHTML = '';
    tags.forEach((tag, index) => {
      const badge = document.createElement('span');
      badge.className = 'tag-badge';
      badge.textContent = tag;

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'tag-close-btn';
      closeBtn.innerHTML = '&times;';
      closeBtn.ariaLabel = `Remove tag ${tag}`;
      closeBtn.addEventListener('click', () => removeTag(index));

      badge.appendChild(closeBtn);
      tagsList.appendChild(badge);
    });

    // Update hidden field value
    hiddenTopicInput.value = tags.join(', ');
  }

  function addTag(text) {
    const clean = text.replace(/,$/, '').trim();
    if (clean && !tags.includes(clean)) {
      tags.push(clean);
      updateTags();
    }
  }

  function removeTag(index) {
    tags.splice(index, 1);
    updateTags();
  }

  if (topicInputField && tagsList && hiddenTopicInput) {
    // Listen for commas, Enter key, or backspaces in inputs
    topicInputField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTag(topicInputField.value);
        topicInputField.value = '';
      } else if (e.key === ',') {
        e.preventDefault();
        addTag(topicInputField.value);
        topicInputField.value = '';
      } else if (e.key === 'Backspace' && topicInputField.value === '' && tags.length > 0) {
        tags.pop();
        updateTags();
      }
    });

    // Handle losing focus
    topicInputField.addEventListener('blur', () => {
      if (topicInputField.value.trim()) {
        addTag(topicInputField.value);
        topicInputField.value = '';
      }
    });
  }

  /**
   * Question Count Button Selector Groups
   */
  const countButtons = document.querySelectorAll('.q-count-btn');
  const countInput = document.getElementById('quiz-question-count');

  if (countButtons && countInput) {
    countButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        countButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        countInput.value = btn.getAttribute('data-value');
      });
    });
  }

  /**
   * Fetch and populate global dashboard metrics from backend.
   */
  async function loadDashboardStats() {
    try {
      const response = await fetch(`${API_BASE_URL}/quiz/stats`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) throw new Error('API server returned error status.');
      
      const data = await response.json();
      if (data.success && data.stats) {
        const { totalGenerated, totalTaken, averageAccuracy, integrityRate } = data.stats;
        
        statsTotalGenerated.textContent = totalGenerated.toLocaleString();
        statsTotalTaken.textContent = totalTaken.toLocaleString();
        statsAvgAccuracy.textContent = `${averageAccuracy}%`;
        statsIntegrityRate.textContent = `${integrityRate}%`;
      }
    } catch (err) {
      console.error('Failed to load global metrics:', err);
      // Fallback indicators in case backend is offline
      statsTotalGenerated.textContent = 'Offline';
      statsTotalTaken.textContent = 'Offline';
      statsAvgAccuracy.textContent = '--';
      statsIntegrityRate.textContent = '--';
    }
  }

  // Execute stats sync immediately on load
  loadDashboardStats();

  /**
   * Triggers the AI generation process with custom UX animations.
   */
  if (configForm) {
    configForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Retrieve form inputs
      const topic = hiddenTopicInput.value.trim();
      const difficultyInput = document.querySelector('input[name="difficulty"]:checked');
      const countValue = countInput ? parseInt(countInput.value, 10) : 10;

      if (!topic) {
        alert('Please enter at least one keyword topic.');
        topicInputField.focus();
        return;
      }
      
      if (!difficultyInput) return;
      const difficulty = difficultyInput.value;

      // Reset loading progress state
      let progress = 0;
      progressBarFill.style.width = '0%';
      progressPercentage.textContent = '0%';
      modalTitle.textContent = 'Initializing AI Core';
      modalDesc.textContent = 'Establishing secure channel to Google Gen AI...';
      loadingModal.setAttribute('aria-hidden', 'false');

      // Cycle descriptive text during loading
      const loadingStages = [
        { pct: 15, title: 'Connecting to AI Engine', desc: 'Warming up gemini-2.5-flash assessment nodes...' },
        { pct: 35, title: 'Analyzing Subject Matter', desc: `Scanning academic taxonomy guidelines for "${topic}"...` },
        { pct: 55, title: 'Assembling Assessment Card', desc: `Structuring ${countValue} questions suited for a ${difficulty} evaluation...` },
        { pct: 75, title: 'Injecting Academic Rationales', desc: 'Formulating detailed explanatory cards for correct answers...' },
        { pct: 90, title: 'Verifying Structure', desc: 'Validating response schemas against strict structural criteria...' }
      ];

      // Smooth progress bar visualization
      const progressTimer = setInterval(() => {
        if (progress < 92) {
          progress += 1;
          progressBarFill.style.width = `${progress}%`;
          progressPercentage.textContent = `${progress}%`;

          // Update message stages
          const stage = loadingStages.find(s => s.pct === progress);
          if (stage) {
            modalTitle.textContent = stage.title;
            modalDesc.textContent = stage.desc;
          }
        }
      }, 180);

      try {
        // Dispatches request to the server API generator
        const response = await fetch(`${API_BASE_URL}/quiz/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ 
            topic, 
            difficulty,
            count: countValue
          })
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || 'Server failed to build quiz assessment.');
        }

        const data = await response.json();

        if (data.success && data.quiz) {
          // Force progress metrics to maximum completion
          clearInterval(progressTimer);
          progressBarFill.style.width = '100%';
          progressPercentage.textContent = '100%';
          modalTitle.textContent = 'Quiz Forged!';
          modalDesc.textContent = 'Buffering questions into local memory decks...';

          // Cache the quiz structure into localstorage for quiz-player access
          localStorage.setItem('quizforge_current_quiz', JSON.stringify(data.quiz));

          // Pause momentarily to show 100% completion before routing
          setTimeout(() => {
            loadingModal.setAttribute('aria-hidden', 'true');
            window.location.href = 'quiz.html';
          }, 800);
        } else {
          throw new Error('Malformed generation payload received.');
        }
      } catch (err) {
        clearInterval(progressTimer);
        loadingModal.setAttribute('aria-hidden', 'true');
        console.error('Generation Error:', err);
        alert(`Assessment Generation Failed:\n\n${err.message}\n\nPlease try again.`);
      }
    });
  }
});
