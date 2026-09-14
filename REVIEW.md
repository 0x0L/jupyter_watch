# Project review

Reviewed on 2026-09-14: Python lifecycle and delivery, browser routing and rendering, controls, scrolling, accessibility, naming, comments, documentation, dependencies, and packaging.

## Changes

- **Startup reliability:** guard both access to browser storage and storage operations. Theme and View settings remain usable when persistence is blocked. Invalid saved themes fall back to the system preference.
- **Layout:** let the sticky header occupy its actual height. Use one prompt width across inputs, outputs, folded placeholders, and the empty state. Keep copy controls outside content; place output controls below content on narrow or touch screens.
- **Accessibility:** retain visible status text on mobile, announce status changes and filename copy results, add an SVG alternative label and select focus outline, and use real HTML for the empty state.
- **Naming and comments:** replace obsolete floating-button names with `theme-toggle`, `follow-control`, and `follow-output`; use `output-only` consistently; label individual copying as **Copy output**. Remove redundant section comments and obsolete launcher documentation.
- **Tooling:** correct the Node requirement to match the installed lint tooling. Update Vitest to 4.1.11, which resolves the dependency audit findings for [GHSA-82fw-gwwq-j7x9](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9).

## Architecture

The existing passive architecture remains appropriate. Jupyter owns message validation, stream normalization, and output models. The backend observes IOPub and heartbeat without owning kernel execution or shutdown. Delivery queues and browser retention are bounded; reconnects start fresh. Host/Origin checks and untrusted output rendering remain covered by tests.

No backend implementation changes were needed for the issues found in this pass.

## Validation

- Ruff and Prettier formatting, ESLint, and whitespace checks pass.
- 31 Python tests, 15 JavaScript tests, and 9 Chromium tests pass.
- Browser coverage includes blocked storage, clipboard success/failure, prompt alignment, controls without overlap, and View menu bounds at 320, 390, 760, and 1280 pixels.
- Desktop and mobile screenshots were visually inspected. No interactive browser was connected; visual inspection used the Chromium suite's screenshots.
- Production build and distribution smoke checks pass, including an installed wheel without Node and a wheel rebuilt from the source distribution.
- npm reports zero known vulnerabilities after the Vitest update. This audit covers npm dependencies, not Python advisories or a full security assessment.

## Remaining limitations

The production build still reports upstream JupyterLab `eval` usage and large rendering bundles. Plotly already loads separately on demand; reducing its size would require choosing a smaller chart feature set. Python tests also report upstream Starlette/httpx and AnyIO deprecations. These do not fail the current checks.

Browser behavior was verified in Chromium; Safari and Firefox were not tested in this pass.
