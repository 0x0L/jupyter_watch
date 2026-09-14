// Storage can be unavailable even when the browser exposes localStorage.
export function readPreference(key, storage) {
  try {
    return (storage ?? window.localStorage).getItem(key);
  } catch {
    return null;
  }
}

export function savePreference(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Keep settings usable for this page when persistence is blocked.
  }
}
