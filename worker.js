// Web Worker: Python (Pyodide) запускается здесь, чтобы бесконечный цикл в решении
// не подвешивал интерфейс — главный поток просто убивает воркер по таймауту.
const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";
const WEB_PACKAGES = ["fastapi==0.115.6", "httpx==0.27.2"];

let py = null;
let ready = null;
let webPackagesReady = false;

function boot(shim) {
  if (!ready) {
    ready = (async () => {
      importScripts(PYODIDE_URL + "pyodide.js");
      py = await loadPyodide({ indexURL: PYODIDE_URL });
      py.runPython(shim);
    })();
  }
  return ready;
}

async function ensurePackages(src, progress) {
  progress("Загружаю библиотеки…");
  await py.loadPackagesFromImports(src, { messageCallback: () => {} });
  if (!webPackagesReady && /\b(fastapi|httpx|starlette)\b/.test(src)) {
    progress("Устанавливаю FastAPI (только в первый раз)…");
    await py.loadPackage("micropip", { messageCallback: () => {} });
    py.globals.set("WEB_PACKAGES", py.toPy(WEB_PACKAGES));
    await py.runPythonAsync("import micropip\nawait micropip.install(WEB_PACKAGES)");
    py.runPython("patch_fastapi()");
    webPackagesReady = true;
  }
}

self.onmessage = async (e) => {
  const { id, kind, shim, files, stdin } = e.data;
  const progress = (text) => self.postMessage({ id, phase: "progress", text });
  try {
    progress("Запускаю Python…");
    try {
      await boot(shim);
    } catch (err) {
      ready = null;
      py = null;
      self.postMessage({ id, phase: "done", result: { error: String(err && err.message || err), boot: true } });
      return;
    }
    await ensurePackages(Object.values(files).join("\n"), progress);
    self.postMessage({ id, phase: "running" });
    py.globals.set("FILES", JSON.stringify(files));
    py.globals.set("STDIN", stdin || "");
    const raw = kind === "tests" ? py.runPython("run_tests(FILES)") : py.runPython("run_program(FILES, STDIN)");
    self.postMessage({ id, phase: "done", result: JSON.parse(raw) });
  } catch (err) {
    self.postMessage({ id, phase: "done", result: { error: String(err && err.message || err) } });
  }
};
