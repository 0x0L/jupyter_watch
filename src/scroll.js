/** Separate incoming activity from user-requested layout changes. */
export function setupScroll(container, checkbox, label) {
  let follow = checkbox.checked;
  let followLayout = true;
  let preserving = 0;
  let sequence = 0;
  let ignoreScrollUntil = 0;
  let activityDuringChange = false;
  let anchor = null;
  let anchorTop = 0;
  function sync() {
    checkbox.checked = follow;
    label.classList.toggle("off", !follow);
  }
  function toBottom() {
    ignoreScrollUntil = window.performance.now() + 100;
    window.scrollTo(0, document.documentElement.scrollHeight);
  }
  function restoreAnchor() {
    if (anchor?.isConnected) {
      ignoreScrollUntil = window.performance.now() + 100;
      window.scrollBy(0, anchor.getBoundingClientRect().top - anchorTop);
    }
  }
  function userScroll() {
    ignoreScrollUntil = 0;
    followLayout = false;
  }
  window.addEventListener("wheel", userScroll, { passive: true });
  window.addEventListener("touchmove", userScroll, { passive: true });
  window.addEventListener("keydown", (event) => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
      userScroll();
    }
  });
  window.addEventListener("scroll", () => {
    if (preserving || window.performance.now() < ignoreScrollUntil) return;
    follow = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 50;
    followLayout = follow;
    sync();
  });
  checkbox.addEventListener("change", () => {
    follow = checkbox.checked;
    followLayout = follow;
    sync();
    if (follow) toBottom();
  });
  const observer = new ResizeObserver(() => {
    if (preserving) restoreAnchor();
    else if (follow && followLayout) toBottom();
  });
  observer.observe(container);
  return {
    async preservePosition(change, preferredAnchor) {
      const token = ++sequence;
      preserving = token;
      followLayout = false;
      activityDuringChange = false;
      const headerBottom = document.getElementById("header").getBoundingClientRect().bottom;
      anchor =
        preferredAnchor ||
        [...container.children].find((el) => el.getBoundingClientRect().bottom > headerBottom);
      anchorTop = anchor?.getBoundingClientRect().top ?? 0;
      try {
        await change();
        restoreAnchor();
        await new Promise((resolve) =>
          window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
        );
      } finally {
        if (token === preserving) {
          restoreAnchor();
          preserving = 0;
          anchor = null;
          ignoreScrollUntil = window.performance.now() + 100;
          if (activityDuringChange && follow) {
            followLayout = true;
            toBottom();
          }
        }
      }
    },
    activity() {
      if (preserving) activityDuringChange = true;
      else {
        followLayout = true;
        if (follow) toBottom();
      }
    },
  };
}
