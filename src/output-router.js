import { OutputAreaModel } from "@jupyterlab/outputarea";

/** Route passive IOPub observations into Jupyter's output models. */
export class OutputRouter {
  constructor({ createCell, onTruncate = () => {}, maxCells = 200, maxBytes = 20 * 1024 * 1024 }) {
    this.createCell = createCell;
    this.onTruncate = onTruncate;
    this.maxCells = maxCells;
    this.maxBytes = maxBytes;
    this.cells = new Map();
    this.displayIds = new WeakMap();
    this.bytes = 0;
  }
  reset() {
    for (const id of this.cells.keys()) this.remove(id);
    this.displayIds = new WeakMap();
  }
  remove(id) {
    const cell = this.cells.get(id);
    cell.view.dispose();
    cell.model.dispose();
    this.bytes -= cell.bytes;
    this.cells.delete(id);
  }
  handle(message) {
    const type = message.header?.msg_type;
    const content = message.content;
    if (
      ![
        "execute_input",
        "execute_result",
        "display_data",
        "update_display_data",
        "stream",
        "error",
        "clear_output",
      ].includes(type)
    )
      return;
    const displayId = content.transient?.display_id;
    if (displayId && ["display_data", "execute_result", "update_display_data"].includes(type)) {
      for (const cell of this.cells.values()) {
        for (let i = 0; i < cell.model.length; i++) {
          const output = cell.model.get(i);
          if (this.displayIds.get(output) === displayId) {
            output.setData({ data: content.data, metadata: content.metadata || {} });
            this.account(cell, message);
          }
        }
      }
    }
    // Updates affect known display IDs only; they never create a new output.
    if (type === "update_display_data") {
      this.trim();
      return;
    }
    const id = message.parent_header?.msg_id || "_unparented";
    let cell = this.cells.get(id);
    if (!cell) {
      if (type === "clear_output") return;
      const model = new OutputAreaModel({ trusted: false });
      cell = { model, view: this.createCell(model), bytes: 0 };
      this.cells.set(id, cell);
    }
    if (type === "execute_input") {
      cell.view.setInput(content.code, content.execution_count);
    } else if (type === "clear_output") {
      cell.model.clear(content.wait === true);
    } else {
      const index = cell.model.add({ ...content, output_type: type }) - 1;
      if (displayId) this.displayIds.set(cell.model.get(index), displayId);
    }
    this.account(cell, message);
    this.trim();
  }
  account(cell, message) {
    // Conservatively count traffic, including replaced outputs. JS strings may
    // use two bytes. This also bounds continuously growing individual streams.
    const bytes = JSON.stringify(message).length * 2;
    cell.bytes += bytes;
    this.bytes += bytes;
  }
  trim() {
    while (this.cells.size > this.maxCells || this.bytes > this.maxBytes) {
      this.remove(this.cells.keys().next().value);
      this.onTruncate();
    }
  }
}
