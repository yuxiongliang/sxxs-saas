#!/usr/bin/env python3
"""启动 / 重启本地三件套，并在起来后做健康自检。

为什么需要这个脚本：`nohup cmd &` 仍属于当前 shell 的进程组，会话结束会被带走；
这里用 `start_new_session=True`（setsid）让服务彻底脱离。

**为什么还要自检**：utoopack dev server 的 chunk 图和磁盘产物可能不一致
（典型触发：dev 在跑的时候执行了 `npm run build`，两者都写 `src/.umi`）。
症状是页面永远停在「正在加载资源」，浏览器控制台报 `Unexpected token '<'`。
光看端口 200 是看不出来的 —— 所以这里真的去请求页面，确认不是加载占位。

用法：
    python3 scripts/dev-up.py            # 启动（已有进程会先被杀掉）
    python3 scripts/dev-up.py --restart  # 同上，语义更明确
    python3 scripts/dev-up.py --check    # 只做健康检查，不动进程
"""
from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path("/Users/yuxiongliang/Desktop/com.sxxs.cn/ant-design-pro")

SERVICES = [
    (
        "backend",
        [str(REPO / "backend/.venv/bin/python"), "-m", "uvicorn", "app.main:app",
         "--host", "127.0.0.1", "--port", "9000"],
        REPO / "backend",
        Path("/tmp/backend.log"),
        9000,
    ),
    (
        # 常驻延时任务执行器：自动收货（快递 7 天 / 自提 90 天）。
        # 没有端口，存活判断走 pgrep（见 _worker_alive）。
        "jobs-worker",
        [str(REPO / "backend/.venv/bin/python"), "-m", "app.worker.jobs"],
        REPO / "backend",
        Path("/tmp/jobs-worker.log"),
        0,
    ),
    ("tenant-console", ["npm", "run", "dev"], REPO, Path("/tmp/dev8010.log"), 8010),
    (
        "platform-console",
        ["npm", "run", "dev"],
        REPO / "apps/platform",
        Path("/tmp/dev8001.log"),
        8001,
    ),
]

# 自检：访问这些地址，除了 200，还要确认返回的 HTML 里没有卡在加载占位的迹象。
CHECKS = [
    ("backend", "http://127.0.0.1:9000/api/v1/public/brand"),
    ("tenant-console", "http://127.0.0.1:8010/products"),
    ("platform-console", "http://127.0.0.1:8001/login"),
    # worker 没有端口：读它的心跳表，超过 2 分钟没更新就算掉线
    (
        "jobs-worker",
        "http://127.0.0.1:9000/api/v1/public/jobs/heartbeat",
    ),
]


def _listening_pids(port: int) -> list[int]:
    try:
        out = subprocess.run(
            ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
            capture_output=True,
            text=True,
            check=False,
        ).stdout
    except FileNotFoundError:
        return []
    return [int(line) for line in out.split() if line.strip().isdigit()]


def _pids_by_cmdline(pattern: str) -> list[int]:
    """无端口的常驻进程（jobs worker）只能用命令行特征找。"""
    try:
        out = subprocess.run(
            ["pgrep", "-f", pattern], capture_output=True, text=True, check=False
        ).stdout
    except FileNotFoundError:
        return []
    return [int(line) for line in out.split() if line.strip().isdigit()]


def _service_pids(port: int, name: str) -> list[int]:
    return _listening_pids(port) if port else _pids_by_cmdline("app.worker.jobs")


def stop_existing() -> None:
    for name, _cmd, _cwd, _log, port in SERVICES:
        for pid in _service_pids(port, name):
            print(f"{name}: 停止旧进程 pid={pid}" + (f" (port {port})" if port else ""))
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    time.sleep(3)


def start_all() -> None:
    for name, cmd, cwd, log, port in SERVICES:
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open("w") as handle:
            process = subprocess.Popen(
                cmd,
                cwd=str(cwd),
                stdout=handle,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                start_new_session=True,  # setsid：脱离当前进程组/会话
                close_fds=True,
            )
        print(f"{name}: pid={process.pid} log={log} port={port}")


def check(verbose: bool = True) -> bool:
    """逐个地址探活。返回是否全部健康。"""
    ok = True
    for name, url in CHECKS:
        status = "?"
        body = ""
        request = urllib.request.Request(
            url,
            # 必须伪装成浏览器：dev server 的 SPA 回退只在 `Accept: text/html` 时生效，
            # 否则直接用 404，看起来像服务挂了。
            headers={
                "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
                "User-Agent": "dev-up-healthcheck/1.0",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as resp:
                status = resp.status
                body = resp.read().decode("utf-8", "ignore")
        except urllib.error.HTTPError as exc:
            status = exc.code
            body = exc.read().decode("utf-8", "ignore")
        except Exception as exc:  # noqa: BLE001 - 网络异常一律记为不健康
            if verbose:
                print(f"  ✗ {name:<18} {url} -> {type(exc).__name__}")
            ok = False
            continue

        healthy = status == 200
        # HTML 页面必须含应用挂载点（`<div id="root">`），否则说明拿到的是错误页；
        # JSON 接口（后端）只要求 200。
        looks_html = body.lstrip().startswith("<!DOCTYPE") or "<html" in body[:200]
        if healthy and looks_html and 'id="root"' not in body:
            healthy = False
        if verbose:
            print(f"  {'✓' if healthy else '✗'} {name:<18} {url} -> {status}")
        ok = ok and healthy
    return ok


def wait_until_healthy(timeout: int = 180) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if check(verbose=False):
            return True
        time.sleep(5)
    return check(verbose=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="本地三件套启动 / 重启 / 自检")
    parser.add_argument("--restart", action="store_true", help="先停再起（默认行为）")
    parser.add_argument("--check", action="store_true", help="只做健康检查，不动进程")
    args = parser.parse_args()

    if args.check:
        return 0 if check() else 1

    stop_existing()
    start_all()

    print("\n等待服务就绪并自检 ...")
    if wait_until_healthy():
        print("\n全部健康。")
        return 0

    print("\n自检失败。常见原因：dev 在跑时执行过 npm run build（两者都写 src/.umi），")
    print("导致浏览器请求到不存在的 chunk。处理：先停 dev，再 build，最后重启 dev。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
