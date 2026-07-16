const API_BASE_URL = '/api';

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

  const otpForm = document.getElementById('otp-form');
  const otpCodeInput = document.getElementById('otp-code-input');
  const otpEmailDisplay = document.getElementById('otp-email-display');
  const resendOtpLink = document.getElementById('resend-otp-link');
  const backToSignupLink = document.getElementById('back-to-signup-link');

  let pendingSignupEmail = null;

  function showSignupForm() {
    signupForm.style.display = 'block';
    otpForm.style.display = 'none';
    authTitle.textContent = 'Create Account';
    authSubtitle.textContent = 'Sign up to start forging and tracking your assessments';
    submitBtn.querySelector('.btn-text').textContent = 'Get Started';
  }

  function showOtpForm(email) {
    signupForm.style.display = 'none';
    otpForm.style.display = 'block';
    otpEmailDisplay.textContent = email;
    authTitle.textContent = 'Verify Your Account';
    authSubtitle.textContent = 'Enter the 6-digit code sent to your email to complete registration.';
  }

  async function handleSignupSubmit(e) {
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
        pendingSignupEmail = data.email || email;

        if (data.devOtp) {
          const verifyResp = await fetch(`${API_BASE_URL}/auth/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: pendingSignupEmail, otp: data.devOtp })
          });
          const verifyData = await verifyResp.json();
          if (verifyResp.ok && verifyData.success && verifyData.token) {
            localStorage.setItem('quizforge_auth_token', verifyData.token);
            localStorage.setItem('quizforge_user_name', verifyData.user.name);
            localStorage.setItem('quizforge_user_email', verifyData.user.email);
            window.location.href = './index.html';
            return;
          }
        }

        if (data.emailSent === false) {
          showError('OTP email could not be sent. Please try again or use a different email.');
          loadCaptcha();
          return;
        }

        showOtpForm(pendingSignupEmail);
      } else {
        throw new Error('Received malformed response payload from authentication server.');
      }
    } catch (err) {
      console.error('Signup Error:', err);
      showError(err.message);
      loadCaptcha();
    } finally {
      submitBtn.disabled = false;
      const btnTextFinal = submitBtn.querySelector('.btn-text');
      if (btnTextFinal) btnTextFinal.textContent = 'Get Started';
    }
  }

  async function handleOtpSubmit(e) {
    e.preventDefault();

    const otpCode = otpCodeInput.value.trim();
    if (!otpCode || !pendingSignupEmail) {
      showError('Please enter the 6-digit verification code.');
      return;
    }

    try {
      otpCodeInput.disabled = true;
      const verifyBtn = document.getElementById('otp-verify-btn');
      if (verifyBtn) verifyBtn.disabled = true;
      hideError();

      const response = await fetch(`${API_BASE_URL}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingSignupEmail, otp: otpCode })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Verification failed.');
      }

      if (data.success && data.token) {
        localStorage.setItem('quizforge_auth_token', data.token);
        localStorage.setItem('quizforge_user_name', data.user.name);
        localStorage.setItem('quizforge_user_email', data.user.email);
        window.location.href = './index.html';
        return;
      }

      throw new Error('Invalid verification response from server.');
    } catch (err) {
      console.error('OTP Verification Error:', err);
      showError(err.message);
    } finally {
      otpCodeInput.disabled = false;
      const verifyBtn = document.getElementById('otp-verify-btn');
      if (verifyBtn) verifyBtn.disabled = false;
    }
  }

  async function handleResendOtp(e) {
    e.preventDefault();
    if (!pendingSignupEmail) {
      showError('No pending signup session found. Please fill the signup form again.');
      return;
    }

    try {
      hideError();
      const response = await fetch(`${API_BASE_URL}/auth/resend-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingSignupEmail })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Resend OTP failed.');
      }
      if (data.success) {
        showError('A new verification code has been sent. Check your email.');
      }
    } catch (err) {
      console.error('Resend OTP Error:', err);
      showError(err.message);
    }
  }

  function handleBackToSignup(e) {
    e.preventDefault();
    pendingSignupEmail = null;
    otpCodeInput.value = '';
    showSignupForm();
    loadCaptcha();
  }

  signupForm.addEventListener('submit', handleSignupSubmit);
  otpForm.addEventListener('submit', handleOtpSubmit);
  resendOtpLink.addEventListener('click', handleResendOtp);
  backToSignupLink.addEventListener('click', handleBackToSignup);

  // Initial captcha fetch
  loadCaptcha();

  refreshCaptchaBtn.addEventListener('click', loadCaptcha);

  function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.style.display = 'block';
  }

  function hideError() {
    errorBanner.textContent = '';
    errorBanner.style.display = 'none';
  }
});
