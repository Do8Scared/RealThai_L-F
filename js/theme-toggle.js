const THEME_STORAGE_KEY = 'iskofinds-theme';
const THEME_MODES = ['dark', 'light'];
let activeThemeTransition = 0;

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
    toggle.title = `Switch to ${isDark ? 'light' : 'dark'} mode`;
  });

  if (persist) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) {
      console.warn('Could not save the color theme preference.', error);
    }
  }
}

function transitionTheme(theme, persist = true) {
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

applyTheme(readSavedTheme());

document.querySelectorAll('.theme-toggle').forEach((toggle) => {
  toggle.addEventListener('click', () => {
    transitionTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark');
  });
});

window.addEventListener('storage', (event) => {
  if (event.key === THEME_STORAGE_KEY && event.newValue) {
    transitionTheme(event.newValue, false);
  }
});
