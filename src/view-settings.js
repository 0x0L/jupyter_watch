import { readPreference, savePreference } from "./preferences.js";

export const LANGUAGES = ["python", "javascript", "bash", "json", "plaintext"];
const STORAGE_KEY = "jupyter-watch-view";

export function readViewPreferences(storage) {
  try {
    const saved = JSON.parse(readPreference(STORAGE_KEY, storage));
    return {
      wrap: saved?.wrap === true,
      language: LANGUAGES.includes(saved?.language) ? saved.language : "python",
    };
  } catch {
    return { wrap: false, language: "python" };
  }
}

export function setupViewSettings(onChange) {
  const preferences = readViewPreferences();
  const menu = document.getElementById("view-settings");
  const trigger = menu.querySelector("summary");
  const wrap = document.getElementById("wrap-input");
  const language = document.getElementById("input-language");
  wrap.checked = preferences.wrap;
  language.value = preferences.language;
  document.body.classList.toggle("wrap-input", preferences.wrap);
  function change() {
    preferences.wrap = wrap.checked;
    preferences.language = language.value;
    savePreference(STORAGE_KEY, JSON.stringify(preferences));
    onChange(preferences);
  }
  wrap.addEventListener("change", change);
  language.addEventListener("change", change);
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      menu.open = false;
      trigger.focus({ preventScroll: true });
      event.preventDefault();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!menu.contains(event.target)) menu.open = false;
  });
  return preferences;
}
