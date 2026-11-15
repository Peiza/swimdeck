// Sets the saved theme before the first paint (a separate file so the page can run without inline scripts).
try { var t = JSON.parse(localStorage.getItem('swimdeck.theme')); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}
