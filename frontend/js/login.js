const API_BASE_URL = '/api';

document.addEventListener('DOMContentLoaded', () => {
  // Check if already logged in
  if (localStorage.getItem('quizforge_auth_token')) {
    window.location.href = './index.html';
    return;
  }

  const loginForm = document.getElementById('login-form');
  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  const captchaInput = document.getElementById('captcha-input');
  const captchaContainer = document.getElementById('captcha-svg-container');
  const refreshCaptchaBtn = document.getElementById('refresh-captcha-btn');
  const errorBanner = document.getElementById('error-banner');
  const submitBtn = document.getElementById('submit-btn');

  let activeCaptchaId = null;

  async function loadCaptcha() {
    try {
      captchaContainer.innerHTML = '<span style="font-size: 0.75rem; color: #94a3b8;">Loading CAPTCHA...</span>';
      const response = await fetch(`${API_BASE_URL}/auth/captcha`);
      if (!response.ok) throw new Error('Failed to fetch captcha.');
      
      const data = await response.json();
      if (data.success && data.svg) {
        activeCaptchaId = data.captchaId;
        captchaContainer.innerHTML = data.svg;
        captchaInput.value = '';
      }
    } catch (err) {
      console.error('Error loading CAPTCHA:', err);
      captchaContainer.innerHTML = '<span style="font-size: 0.75rem; color: #ef4444; font-weight: 500;">Failed to load CAPTCHA.</span>';
    }
  }

  // Initial captcha fetch
  loadCaptcha();

  refreshCaptchaBtn.addEventListener('click', loadCaptcha);

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const captchaAnswer = captchaInput.value.trim();

    if (!email || !password || !captchaAnswer || !activeCaptchaId) {
      showError('Please fill in all fields.');
      return;
    }

    try {
      submitBtn.disabled = true;
      const btnText = submitBtn.querySelector('.btn-text');
      if (btnText) btnText.textContent = 'Signing In...';
      hideError();

      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          password,
          captchaId: activeCaptchaId,
          captchaAnswer
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login verification failed.');
      }

      if (data.success && data.token) {
        localStorage.setItem('quizforge_auth_token', data.token);
        localStorage.setItem('quizforge_user_name', data.user.name);
        localStorage.setItem('quizforge_user_email', data.user.email);
        
        window.location.href = 'index.html';
      } else {
        throw new Error('Received malformed response payload from authentication server.');
      }
    } catch (err) {
      console.error('Login Error:', err);
      showError(err.message);
      // Reload captcha on fail
      loadCaptcha();
    } finally {
      submitBtn.disabled = false;
      const btnTextFinal = submitBtn.querySelector('.btn-text');
      if (btnTextFinal) btnTextFinal.textContent = 'Sign In';
    }
  });

  function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.style.display = 'block';
  }

  function hideError() {
    errorBanner.textContent = '';
    errorBanner.style.display = 'none';
  }
});
