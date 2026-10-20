/* Background worker for the importer, so reading a whole book never freezes the app. */
import { run } from "./core.js";

let ctrl = null;

self.onmessage = async (e) => {
  const d = e.data || {};
  if (d.cmd === "cancel") { if (ctrl) ctrl.abort(); return; }
  if (d.cmd !== "run") return;
  ctrl = new AbortController();
  try {
    const r = await run({ file: d.file, name: d.name, appBase: d.appBase, from: d.from, to: d.to, storeFile: d.storeFile,
      signal: ctrl.signal, post: (m) => self.postMessage(m) });
    self.postMessage({ type: "done", id: r.id, stopped: r.stopped });
  } catch (err) {
    self.postMessage({ type: "error", message: String(err && err.message || err) + (err && err.cause ? " [" + (err.cause.message || err.cause) + "]" : ""), stage: err && err.stage || "" });
  }
};

self.postMessage({ type: "ready" });
