const API_BASE_URL = 'http://127.0.0.1:5001/api';

document.addEventListener('DOMContentLoaded', () => {
  // Check if already logged in
  if (localStorage.getItem('quizforge_auth_token')) {
    window.location.href = 'index.html';
    return;
  }

  const signupForm = document.getElementById('signup-form');
  const nameInput = document.getElementById('signup-name');
  const emailInput = document.getElementById('signup-email');
  const passwordInput = document.getElementById('signup-password');
  const captchaInput = document.getElementById('captcha-input');
  const captchaContainer = document.getElementById('captcha-svg-container');
  const refreshCaptchaBtn = document.getElementById('refresh-captcha-btn');
  const errorBanner = document.getElementById('error-banner');
  const submitBtn = document.getElementById('submit-btn');

  // General layout fields
  const authTitle = document.querySelector('.auth-title');
  const authSubtitle = document.querySelector('.auth-subtitle');

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

  // STEP: Registration Details Submit (no OTP step)
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const captchaAnswer = captchaInput.value.trim();

    if (!name || !email || !password || !captchaAnswer || !activeCaptchaId) {
      showError('Please fill in all fields.');
      return;
    }

    try {
      submitBtn.disabled = true;
      const btnText = submitBtn.querySelector('.btn-text');
      if (btnText) btnText.textContent = 'Processing...';
      hideError();

      const response = await fetch(`${API_BASE_URL}/auth/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name,
          email,
          password,
          captchaId: activeCaptchaId,
          captchaAnswer
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Signup request failed.');
      }

      if (data.success) {
        // If backend returned devOtp (no SMTP configured), auto-verify using it and log the user in.
        if (data.devOtp) {
          try {
            const verifyResp = await fetch(`${API_BASE_URL}/auth/verify-otp`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: data.email || email, otp: data.devOtp })
            });
            const verifyData = await verifyResp.json();
            if (verifyResp.ok && verifyData.success && verifyData.token) {
              localStorage.setItem('quizforge_auth_token', verifyData.token);
              localStorage.setItem('quizforge_user_name', verifyData.user.name);
              localStorage.setItem('quizforge_user_email', verifyData.user.email);
              window.location.href = './index.html';
              return;
            }
            // If verification failed for any reason, fall through to redirect to login
          } catch (err) {
            console.error('Auto-verification failed:', err);
          }
        }

        // For environments where SMTP is configured and no devOtp is returned,
        // skip the verification UI and redirect the user to the login page silently.
        window.location.href = './login.html';
      } else {
        throw new Error('Received malformed response payload from authentication server.');
      }
    } catch (err) {
      console.error('Signup Error:', err);
      showError(err.message);
      // Reload captcha on fail
      loadCaptcha();
    } finally {
      submitBtn.disabled = false;
      const btnTextFinal = submitBtn.querySelector('.btn-text');
      if (btnTextFinal) btnTextFinal.textContent = 'Get Started';
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
