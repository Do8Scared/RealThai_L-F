const COOLDOWN_MS = 60_000;
const activeIntervals = new WeakMap();
const memoryExpiries = new Map();

function getStorageKey(scope, email) {
  const value = `${scope}:${email.trim().toLowerCase()}`;
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `auth-link-cooldown:${(hash >>> 0).toString(36)}`;
}

export function createAuthLinkCooldown({
  scope,
  input,
  button,
  disabledButtons = [button],
  status,
  getIdleLabel,
}) {
  let currentEmail = '';
  let pending = false;

  function readExpiry(email) {
    if (!email) return 0;

    const key = getStorageKey(scope, email);
    const memoryExpiry = memoryExpiries.get(key) || 0;
    try {
      const expiry = Number(window.localStorage.getItem(key));
      if (expiry > Date.now()) return Math.max(expiry, memoryExpiry);
      window.localStorage.removeItem(key);
    } catch (error) {
      console.warn('Could not restore the sign-in link cooldown:', error);
    }
    if (memoryExpiry > Date.now()) return memoryExpiry;
    memoryExpiries.delete(key);
    return 0;
  }

  function render() {
    const expiry = readExpiry(currentEmail);
    const seconds = Math.ceil((expiry - Date.now()) / 1000);
    const blocked = seconds > 0;

    input.disabled = pending;
    disabledButtons.forEach(control => {
      control.disabled = pending || blocked;
    });
    const label = pending
      ? 'Sending…'
      : blocked
        ? `Try again in ${seconds}s`
        : getIdleLabel();
    const labelElement = button.querySelector('.auth-submit-label');
    if (labelElement) labelElement.textContent = label;
    else button.textContent = label;

    if (pending && status) {
      status.textContent = 'Requesting a sign-in email…';
      status.classList.remove('error');
    } else if (blocked && status) {
      status.textContent = requestMessage
        || 'A sign-in email was recently requested for this address. Check your inbox and spam folder before requesting another.';
      status.classList.remove('error');
    }

    if (blocked && !activeIntervals.has(button)) {
      activeIntervals.set(button, setInterval(render, 1000));
    } else if (!blocked) {
      const interval = activeIntervals.get(button);
      if (interval) {
        clearInterval(interval);
        activeIntervals.delete(button);
      }
    }
  }

  let requestMessage = '';

  function updateEmail(email) {
    currentEmail = email.trim();
    requestMessage = '';
    render();
    if (!readExpiry(currentEmail) && status) status.textContent = '';
  }

  function start(email, message) {
    currentEmail = email.trim();
    requestMessage = message;
    const expiry = Date.now() + COOLDOWN_MS;
    const key = getStorageKey(scope, currentEmail);
    memoryExpiries.set(key, expiry);
    try {
      window.localStorage.setItem(key, String(expiry));
    } catch (error) {
      console.warn('Could not save the sign-in link cooldown:', error);
    }

    if (status) {
      status.textContent = message;
      status.classList.remove('error');
    }
    render();
  }

  function isCoolingDown(email) {
    currentEmail = email.trim();
    return readExpiry(currentEmail) > Date.now();
  }

  input.addEventListener('input', () => updateEmail(input.value));
  window.addEventListener('storage', event => {
    if (event.key?.startsWith('auth-link-cooldown:')) render();
  });
  updateEmail(input.value);

  return {
    isCoolingDown,
    refresh(email) {
      currentEmail = email.trim();
      render();
    },
    setPending(value) {
      pending = value;
      render();
    },
    start,
  };
}
