"""Среда выполнения курса внутри браузера (Pyodide).

Повторяет поведение trainer/runner.py и trainer/testing.py, но без subprocess и потоков,
которых в WebAssembly нет:
  * asyncio.run      — свой цикл событий, который честно «спит» между таймерами;
  * trainer.testing  — запуск solution.py в том же процессе с подменой stdin/stdout;
  * TestClient       — синхронный клиент FastAPI без фонового потока.
"""
import asyncio
import importlib
import inspect
import io
import json
import os
import runpy
import selectors
import sys
import time
import traceback
import types
from contextlib import redirect_stdout
from pathlib import Path

WORK = Path("/home/pyodide/lesson")
LESSON_MODULES = ("solution", "tests")


# ---------- asyncio без браузерного цикла ----------

class _SleepSelector(selectors.BaseSelector):
    """Селектор без файловых дескрипторов: просто ждёт до ближайшего таймера."""

    def __init__(self):
        self._map = {}

    def register(self, fileobj, events, data=None):
        key = selectors.SelectorKey(fileobj, id(fileobj), events, data)
        self._map[fileobj] = key
        return key

    def unregister(self, fileobj):
        return self._map.pop(fileobj)

    def select(self, timeout=None):
        if timeout is None:
            raise RuntimeError("asyncio: ожидание без таймера — задача никогда не завершится (deadlock)")
        if timeout > 0:
            time.sleep(timeout)
        return []

    def close(self):
        self._map.clear()

    def get_map(self):
        return self._map


class SyncLoop(asyncio.SelectorEventLoop):
    def __init__(self):
        super().__init__(_SleepSelector())

    def _make_self_pipe(self):
        pass

    def _close_self_pipe(self):
        pass

    def _write_to_self(self):
        pass

    def _process_self_data(self, data):
        pass


def run_sync(main, *, debug=None, loop_factory=None):
    """Замена asyncio.run, работающая внутри Pyodide."""
    prev = asyncio.events._get_running_loop()
    asyncio.events._set_running_loop(None)
    try:
        with asyncio.Runner(debug=debug, loop_factory=SyncLoop) as runner:
            return runner.run(main)
    finally:
        asyncio.events._set_running_loop(prev)


asyncio.run = run_sync
asyncio.runners.run = run_sync


# ---------- trainer.testing ----------

def _run_solution(test_file, stdin=""):
    script = Path(test_file).parent / "solution.py"
    out = io.StringIO()
    old_in, old_out, old_argv = sys.stdin, sys.stdout, sys.argv
    sys.stdin, sys.stdout, sys.argv = io.StringIO(stdin), out, [str(script)]
    try:
        runpy.run_path(str(script), run_name="__main__")
    except SystemExit as e:
        if e.code not in (None, 0):
            raise AssertionError(f"Программа завершилась с кодом {e.code}")
    except BaseException as e:
        tail = "\n".join(_short_tb(e).strip().splitlines()[-3:])
        raise AssertionError(f"Программа упала с ошибкой:\n{tail}")
    finally:
        sys.stdin, sys.stdout, sys.argv = old_in, old_out, old_argv
    return out.getvalue()


def _output_lines(test_file, stdin=""):
    return [line.strip() for line in _run_solution(test_file, stdin).strip().splitlines()]


def _expect_lines(test_file, stdin, expected):
    got = _output_lines(test_file, stdin)
    assert got == expected, (
        f"Ввод: {stdin!r}\n        Ожидалось: {expected}\n        Получено:  {got}"
    )


def _require(package):
    try:
        return importlib.import_module(package)
    except ImportError:
        raise AssertionError(f"Пакет «{package}» не загрузился. Проверь интернет и запусти проверку ещё раз.")


def _install_trainer():
    pkg = types.ModuleType("trainer")
    pkg.__path__ = []
    pkg.DAILY_GOAL_SECONDS = 3 * 60 * 60
    testing = types.ModuleType("trainer.testing")
    testing.run_solution = _run_solution
    testing.output_lines = _output_lines
    testing.expect_lines = _expect_lines
    testing.require = _require
    pkg.testing = testing
    sys.modules["trainer"] = pkg
    sys.modules["trainer.testing"] = testing


_install_trainer()


# ---------- FastAPI TestClient без потоков ----------

_fastapi_patched = False


def patch_fastapi():
    """Вызывается после установки fastapi/httpx через micropip."""
    global _fastapi_patched
    if _fastapi_patched:
        return
    import anyio.to_thread
    import httpx

    async def run_inline(func, *args, abandon_on_cancel=False, cancellable=None, limiter=None):
        return func(*args)

    anyio.to_thread.run_sync = run_inline

    class _SyncASGITransport(httpx.BaseTransport):
        def __init__(self, app, raise_server_exceptions=True):
            self._inner = httpx.ASGITransport(app=app, raise_app_exceptions=raise_server_exceptions)

        def handle_request(self, request):
            request.read()

            async def go():
                resp = await self._inner.handle_async_request(request)
                body = b"".join([chunk async for chunk in resp.stream])
                return resp.status_code, resp.headers, body

            status, headers, body = run_sync(go())
            return httpx.Response(status, headers=headers, content=body, request=request)

    class TestClient(httpx.Client):
        __test__ = False

        def __init__(self, app, base_url="http://testserver", raise_server_exceptions=True,
                     headers=None, cookies=None, follow_redirects=True, **_ignored):
            self.app = app
            super().__init__(transport=_SyncASGITransport(app, raise_server_exceptions),
                             base_url=base_url, headers=headers, cookies=cookies,
                             follow_redirects=follow_redirects)

        def __enter__(self):
            router = getattr(self.app, "router", None)
            if router is not None and getattr(router, "on_startup", None):
                async def startup():
                    for handler in router.on_startup:
                        res = handler()
                        if inspect.isawaitable(res):
                            await res
                run_sync(startup())
            return self

        def __exit__(self, *exc):
            router = getattr(self.app, "router", None)
            if router is not None and getattr(router, "on_shutdown", None):
                async def shutdown():
                    for handler in router.on_shutdown:
                        res = handler()
                        if inspect.isawaitable(res):
                            await res
                run_sync(shutdown())
            self.close()

    for name in ("starlette.testclient", "fastapi.testclient"):
        try:
            mod = importlib.import_module(name)
        except Exception:
            mod = types.ModuleType(name)
            sys.modules[name] = mod
        mod.TestClient = TestClient
    _fastapi_patched = True


# ---------- запуск урока ----------

def _short_tb(exc):
    """Трейсбек без внутренностей shim — только код ученика."""
    frames = [f for f in traceback.extract_tb(exc.__traceback__)
              if f.filename.startswith(str(WORK))]
    lines = traceback.format_list(frames) if frames else []
    return "".join(lines) + "".join(traceback.format_exception_only(type(exc), exc))


def _prepare(files):
    if WORK.exists():
        for p in sorted(WORK.rglob("*"), reverse=True):
            p.unlink() if p.is_file() else p.rmdir()
    WORK.mkdir(parents=True, exist_ok=True)
    for name, text in files.items():
        (WORK / name).write_text(text, encoding="utf-8")
    for mod in list(sys.modules):
        if mod in LESSON_MODULES or mod.split(".")[0] in LESSON_MODULES:
            del sys.modules[mod]
    importlib.invalidate_caches()
    if str(WORK) not in sys.path:
        sys.path.insert(0, str(WORK))
    os.chdir(WORK)


def run_tests(files_json):
    """Аналог trainer/runner.py. Возвращает JSON-строку {"results": [...]} или {"error": ...}."""
    _prepare(json.loads(files_json))
    results = []
    try:
        spec = importlib.util.spec_from_file_location("tests", WORK / "tests.py")
        tests = importlib.util.module_from_spec(spec)
        sys.modules["tests"] = tests
        with redirect_stdout(io.StringIO()):
            spec.loader.exec_module(tests)
    except AssertionError as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False)
    except BaseException as e:
        return json.dumps({"error": f"Не удалось загрузить решение:\n{_short_tb(e)}"}, ensure_ascii=False)

    funcs = [(name, f) for name, f in inspect.getmembers(tests, inspect.isfunction)
             if name.startswith("test_") and f.__module__ == "tests"]
    funcs.sort(key=lambda item: item[1].__code__.co_firstlineno)

    for name, func in funcs:
        doc = (func.__doc__ or name).strip()
        try:
            with redirect_stdout(io.StringIO()):
                func()
            results.append({"name": doc, "ok": True})
        except AssertionError as e:
            results.append({"name": doc, "ok": False, "msg": str(e) or "assert не выполнился"})
        except BaseException as e:
            results.append({"name": doc, "ok": False, "msg": f"{type(e).__name__}: {e}"})
    return json.dumps({"results": results}, ensure_ascii=False)


def run_program(files_json, stdin):
    """Запустить solution.py как программу. Возвращает JSON {"out": ..., "err": ...}."""
    _prepare(json.loads(files_json))
    out = io.StringIO()
    err = ""
    old_in, old_out, old_err = sys.stdin, sys.stdout, sys.stderr
    sys.stdin, sys.stdout, sys.stderr = io.StringIO(stdin), out, out
    try:
        runpy.run_path(str(WORK / "solution.py"), run_name="__main__")
    except SystemExit as e:
        if e.code not in (None, 0):
            err = f"SystemExit: {e.code}"
    except BaseException as e:
        err = _short_tb(e)
    finally:
        sys.stdin, sys.stdout, sys.stderr = old_in, old_out, old_err
    return json.dumps({"out": out.getvalue(), "err": err}, ensure_ascii=False)
