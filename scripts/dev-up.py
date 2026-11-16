#!/usr/bin/env python3
"""启动 3 个服务并让它们彻底脱离当前进程组（start_new_session）。

为什么要这么写：普通 `nohup cmd &` 仍属于当前 shell 的进程组，
会话结束时会被一起清掉；`start_new_session=True` 会 setsid，
服务进程成为独立会话首进程，与调用方彻底解耦。
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO = Path("/Users/yuxiongliang/Desktop/com.sxxs.cn/ant-design-pro")

SERVICES = [
    (
        "backend",
        [str(REPO / "backend/.venv/bin/python"), "-m", "uvicorn", "app.main:app",
         "--host", "127.0.0.1", "--port", "9000"],
        REPO / "backend",
        Path("/tmp/backend.log"),
    ),
    ("tenant-console", ["npm", "run", "dev"], REPO, Path("/tmp/dev8010.log")),
    ("platform-console", ["npm", "run", "dev"], REPO / "apps/platform", Path("/tmp/dev8001.log")),
]


def main() -> int:
    for name, cmd, cwd, log in SERVICES:
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
        print(f"{name}: pid={process.pid} log={log}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
