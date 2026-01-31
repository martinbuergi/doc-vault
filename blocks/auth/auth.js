/**
 * Auth Block
 * Login and registration forms
 */

import { login, register, isAuthenticated, getCurrentUser } from '../../scripts/api.js';

export default async function decorate(block) {
  // Check if already authenticated
  if (isAuthenticated()) {
    const user = getCurrentUser();
    block.innerHTML = `
      <div class="auth-logged-in">
        <p>You are logged in as <strong>${escapeHtml(user?.email || 'User')}</strong></p>
        <a href="/dashboard" class="button primary">Go to Dashboard</a>
      </div>
    `;
    return;
  }

  // Determine mode from block content or URL
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode') || (block.textContent.toLowerCase().includes('register') ? 'register' : 'login');

  block.innerHTML = `
    <div class="auth-container">
      <div class="auth-tabs" role="tablist">
        <button class="auth-tab ${mode === 'login' ? 'active' : ''}" data-mode="login" role="tab" aria-selected="${mode === 'login'}">Sign In</button>
        <button class="auth-tab ${mode === 'register' ? 'active' : ''}" data-mode="register" role="tab" aria-selected="${mode === 'register'}">Create Account</button>
      </div>
      
      <form class="auth-form login-form ${mode === 'login' ? 'active' : ''}" data-mode="login">
        <div class="form-group">
          <label for="login-email">Email</label>
          <input type="email" id="login-email" name="email" required autocomplete="email" />
        </div>
        <div class="form-group">
          <label for="login-password">Password</label>
          <input type="password" id="login-password" name="password" required autocomplete="current-password" />
        </div>
        <div class="form-error" role="alert"></div>
        <button type="submit" class="button primary">Sign In</button>
      </form>
      
      <form class="auth-form register-form ${mode === 'register' ? 'active' : ''}" data-mode="register">
        <div class="form-group">
          <label for="register-name">Name</label>
          <input type="text" id="register-name" name="name" autocomplete="name" />
        </div>
        <div class="form-group">
          <label for="register-email">Email</label>
          <input type="email" id="register-email" name="email" required autocomplete="email" />
        </div>
        <div class="form-group">
          <label for="register-password">Password</label>
          <input type="password" id="register-password" name="password" required autocomplete="new-password" minlength="8" />
          <span class="form-hint">At least 8 characters with uppercase, lowercase, and number</span>
        </div>
        <div class="form-group">
          <label for="register-password-confirm">Confirm Password</label>
          <input type="password" id="register-password-confirm" name="password_confirm" required autocomplete="new-password" />
        </div>
        <div class="form-error" role="alert"></div>
        <button type="submit" class="button primary">Create Account</button>
      </form>
    </div>
  `;

  // Tab switching
  const tabs = block.querySelectorAll('.auth-tab');
  const forms = block.querySelectorAll('.auth-form');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabMode = tab.dataset.mode;

      tabs.forEach((t) => {
        t.classList.toggle('active', t.dataset.mode === tabMode);
        t.setAttribute('aria-selected', t.dataset.mode === tabMode);
      });

      forms.forEach((f) => {
        f.classList.toggle('active', f.dataset.mode === tabMode);
      });

      // Update URL
      const url = new URL(window.location.href);
      url.searchParams.set('mode', tabMode);
      window.history.replaceState({}, '', url);
    });
  });

  // Login form handler
  const loginForm = block.querySelector('.login-form');
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(loginForm);
    const errorEl = loginForm.querySelector('.form-error');
    const submitBtn = loginForm.querySelector('button[type="submit"]');

    errorEl.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';

    try {
      await login(formData.get('email'), formData.get('password'));

      // Redirect to dashboard or intended page
      const redirect = new URLSearchParams(window.location.search).get('redirect') || '/dashboard';
      window.location.href = redirect;
    } catch (error) {
      errorEl.textContent = error.message;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  });

  // Register form handler
  const registerForm = block.querySelector('.register-form');
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(registerForm);
    const errorEl = registerForm.querySelector('.form-error');
    const submitBtn = registerForm.querySelector('button[type="submit"]');

    // Validate passwords match
    if (formData.get('password') !== formData.get('password_confirm')) {
      errorEl.textContent = 'Passwords do not match';
      return;
    }

    errorEl.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account...';

    try {
      await register(
        formData.get('email'),
        formData.get('password'),
        formData.get('name'),
      );

      // Redirect to dashboard
      window.location.href = '/dashboard';
    } catch (error) {
      errorEl.textContent = error.message;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Account';
    }
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
