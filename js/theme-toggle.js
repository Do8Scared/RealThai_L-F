const THEME_STORAGE_KEY = 'iskofinds-theme';
const THEME_MODES = ['dark', 'light'];
let activeThemeTransition = 0;
let lockedStorySide = null;

function updateThemeToggleControls() {
  document.querySelectorAll('.theme-toggle').forEach((toggle) => {
    const isDark = document.body.dataset.theme === 'dark';
    const sideLabel = lockedStorySide === 'dark' ? 'Dark Side' : 'Light Side';
    toggle.setAttribute('aria-disabled', String(lockedStorySide !== null));
    toggle.setAttribute('aria-label', lockedStorySide
      ? `${sideLabel} appearance locked until all chosen-side chapters are unlocked`
      : `${isDark ? 'Dark' : 'Light'} mode`);
    toggle.title = lockedStorySide
      ? `${sideLabel} appearance is locked until all chosen-side chapters are unlocked`
      : `Switch to ${isDark ? 'light' : 'dark'} mode`;
  });
}

function readSavedTheme() {
  try {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_MODES.includes(savedTheme) ? savedTheme : 'dark';
  } catch (error) {
    console.warn('Could not read the saved color theme.', error);
    return 'dark';
  }
}

function applyTheme(theme, persist = false) {
  if (!THEME_MODES.includes(theme)) {
    console.error(`Unsupported color theme: ${theme}`);
    return;
  }

  document.body.dataset.theme = theme;
  document.querySelectorAll('.theme-toggle').forEach((toggle) => {
    const isDark = theme === 'dark';
    toggle.setAttribute('aria-checked', String(isDark));
  });
  updateThemeToggleControls();

  if (persist) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) {
      console.warn('Could not save the color theme preference.', error);
    }
  }
}

function transitionTheme(theme, persist = true) {
  if (lockedStorySide && theme !== lockedStorySide) {
    applyTheme(lockedStorySide, persist);
    return;
  }

  const currentTheme = document.body.dataset.theme || 'dark';
  if (!THEME_MODES.includes(theme) || theme === currentTheme) {
    applyTheme(theme, persist);
    return;
  }

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    applyTheme(theme, persist);
    return;
  }

  const direction = theme === 'light' ? 'left-to-right' : 'right-to-left';
  const root = document.documentElement;
  const transitionId = ++activeThemeTransition;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !document.startViewTransition) {
    applyTheme(theme, persist);
    return;
  }

  root.dataset.themeTransition = direction;
  let cleanupTimer;
  const clearDirection = () => {
    window.clearTimeout(cleanupTimer);
    if (transitionId === activeThemeTransition) {
      delete root.dataset.themeTransition;
    }
  };
  const scheduleCleanup = () => {
    window.clearTimeout(cleanupTimer);
    cleanupTimer = window.setTimeout(clearDirection, 100);
  };

  try {
    const transition = document.startViewTransition(() => applyTheme(theme, persist));
    cleanupTimer = window.setTimeout(clearDirection, 1200);
    transition.finished.then(
      scheduleCleanup,
      scheduleCleanup
    );
  } catch (error) {
    clearDirection();
    console.warn('Could not animate the color theme transition.', error);
    applyTheme(theme, persist);
  }
}

window.setThemeToggleLocked = (locked, storySide = 'light') => {
  if (locked && !THEME_MODES.includes(storySide)) {
    console.error(`Unsupported storyline for color theme lock: ${storySide}`);
    return;
  }

  lockedStorySide = locked ? storySide : null;
  if (lockedStorySide) {
    applyTheme(lockedStorySide, true);
  } else {
    updateThemeToggleControls();
  }
};

applyTheme(readSavedTheme());

document.querySelectorAll('.theme-toggle').forEach((toggle) => {
  toggle.addEventListener('click', () => {
    if (lockedStorySide) {
      window.dispatchEvent(new CustomEvent('iskofinds:theme-toggle-locked', {
        detail: { storySide: lockedStorySide },
      }));
      return;
    }
    transitionTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark');
  });
});

window.addEventListener('storage', (event) => {
  if (event.key === THEME_STORAGE_KEY && event.newValue) {
    transitionTheme(lockedStorySide || event.newValue, false);
  }
});
