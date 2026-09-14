import { vi } from "vitest";
if (typeof window !== "undefined") {
  vi.stubGlobal("DragEvent", class extends window.MouseEvent {});
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
}
