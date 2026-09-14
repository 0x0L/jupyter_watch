"""Release artifacts must be self-contained; editable installs can precede Vite."""

from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version, build_data):
        if version == "editable":
            return
        static = Path(self.root) / "src/jupyter_watch/static"
        if not (static / "index.html").is_file() or not any((static / "assets").glob("*.js")):
            raise RuntimeError(
                "Frontend assets missing. Run npm ci && npm run build before uv build."
            )
        destination = (
            "jupyter_watch/static" if self.target_name == "wheel" else "src/jupyter_watch/static"
        )
        build_data["force_include"][str(static)] = destination
