"""Capture actual sync/async Python SDK HTTP requests for Node conformance tests.

Uses HTTPX's in-process transport, with no network or credentials. Regenerate with
python-sdk/.venv/bin/python tests/parity/export_wire_reference.py ../python-sdk.
"""

import asyncio
import importlib.util
import inspect
import json
from pathlib import Path
import sys
from unittest.mock import patch

root = Path(sys.argv[1]).resolve()
import subprocess

revision = subprocess.check_output(
    ["git", "-C", str(root), "rev-parse", "HEAD"], text=True
).strip()
if not revision.startswith("c36d3d9"):
    raise SystemExit(
        "Expected Python reference c36d3d9; review changes before updating fixtures"
    )
sys.path.insert(0, str(root))
import httpx
from hyperbrowser import Hyperbrowser, AsyncHyperbrowser
from hyperbrowser.sandbox_common import RuntimeConnection
from hyperbrowser.models import SandboxTerminalStatus
from hyperbrowser.client.managers.sync_manager.sandboxes.sandbox_transport import (
    RuntimeTransport,
)
from hyperbrowser.client.managers.async_manager.sandboxes.sandbox_transport import (
    RuntimeTransport as AsyncRuntimeTransport,
)
from hyperbrowser.client.managers.sync_manager.sandboxes.sandbox_files import (
    SandboxFilesApi,
)
from hyperbrowser.client.managers.async_manager.sandboxes.sandbox_files import (
    SandboxFilesApi as AsyncFiles,
)
from hyperbrowser.client.managers.sync_manager.sandboxes.sandbox_processes import (
    SandboxProcessesApi,
)
from hyperbrowser.client.managers.async_manager.sandboxes.sandbox_processes import (
    SandboxProcessesApi as AsyncProcesses,
)
from hyperbrowser.client.managers.sync_manager.sandboxes.sandbox_terminal import (
    SandboxTerminalApi,
)
from hyperbrowser.client.managers.async_manager.sandboxes.sandbox_terminal import (
    SandboxTerminalApi as AsyncTerminal,
)

spec = importlib.util.spec_from_file_location(
    "wire", root / "tests/test_sandbox_wire_contract.py"
)
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)
scenarios = []


def add(
    subject, method, args, response, *, kwargs=None, node_method=None, node_args=None
):
    scenarios.append(
        dict(
            name=f"{subject}.{method} {len(scenarios)+1}",
            subject=subject,
            method=method,
            args=args,
            kwargs=kwargs or {},
            nodeMethod=node_method
            or "".join(
                [method.split("_")[0]] + [x.capitalize() for x in method.split("_")[1:]]
            ),
            nodeArgs=args if node_args is None else node_args,
            response=response,
        )
    )


D = w.SANDBOX_DETAIL_PAYLOAD
add(
    "sandboxes",
    "create",
    [
        {
            "image_name": "node",
            "cpu": 4,
            "memory_mib": 4096,
            "disk_mib": 8192,
            "timeout_minutes": 15,
            "enable_recording": False,
            "allow_internet_access": False,
            "allow_out": [],
            "deny_out": ["0.0.0.0/0"],
            "exposed_ports": [{"port": 3000, "auth": False}],
            "mounts": {"/cache": {"id": "vol", "type": "rw", "shared": True}},
        }
    ],
    D,
    node_args=[
        {
            "imageName": "node",
            "cpu": 4,
            "memoryMiB": 4096,
            "diskMiB": 8192,
            "timeoutMinutes": 15,
            "enableRecording": False,
            "allowInternetAccess": False,
            "allowOut": [],
            "denyOut": ["0.0.0.0/0"],
            "exposedPorts": [{"port": 3000, "auth": False}],
            "mounts": {"/cache": {"id": "vol", "type": "rw", "shared": True}},
        }
    ],
)
add(
    "sandboxes",
    "start_from_snapshot",
    [{"snapshot_name": "snap", "snapshot_id": "sid", "timeout_minutes": 20}],
    D,
    node_args=[{"snapshotName": "snap", "snapshotId": "sid", "timeoutMinutes": 20}],
)
add("sandboxes", "get", ["sbx_123"], D)
add("sandboxes", "stop", ["sbx_123"], {"success": True})
for params in [
    {},
    {
        "status": "close-error",
        "start": 100,
        "end": 200,
        "search": "x y",
        "page": 2,
        "limit": 5,
    },
]:
    add("sandboxes", "list", [params], w.SANDBOX_LIST_PAYLOAD)
for params in [
    {},
    {"search": "node", "sources": ["team", "public"], "page": 2, "limit": 5},
]:
    add(
        "sandboxes",
        "list_images",
        [params],
        w.IMAGE_LIST_PAYLOAD,
        node_args=[{("source" if k == "sources" else k): v for k, v in params.items()}],
    )
add(
    "sandboxes",
    "delete_image",
    ["img_123"],
    {"deleted": True, "id": "img_123", "imageName": "node", "uploaded": True},
)
add(
    "sandboxes",
    "list_snapshots",
    [{"status": "created", "image_name": "node", "limit": 100}],
    w.SNAPSHOT_LIST_PAYLOAD,
    node_args=[{"status": "created", "imageName": "node", "limit": 100}],
)
add(
    "sandboxes",
    "get_snapshot",
    ["sid"],
    {"snapshot": w.SNAPSHOT_LIST_PAYLOAD["snapshots"][0]},
)
add("sandboxes", "delete_snapshot", ["sid"], {"deleted": True})
add(
    "sandboxes",
    "create_memory_snapshot",
    ["sbx_123", {"snapshot_name": "snap"}],
    w.SNAPSHOT_RESULT_PAYLOAD,
    node_args=["sbx_123", {"snapshotName": "snap"}],
)
for params in [
    {"allow_internet_access": True},
    {"allow_out": [], "deny_out": []},
    {"allow_internet_access": False, "allow_out": ["example.com"]},
]:
    aliases = {
        "allow_internet_access": "allowInternetAccess",
        "allow_out": "allowOut",
        "deny_out": "denyOut",
    }
    add(
        "sandboxes",
        "update_network",
        ["sbx_123", params],
        w.NETWORK_UPDATE_PAYLOAD,
        node_args=["sbx_123", {aliases[k]: v for k, v in params.items()}],
    )
add("sandboxes", "expose", ["sbx_123", {"port": 3000, "auth": False}], w.EXPOSE_PAYLOAD)
add("sandboxes", "unexpose", ["sbx_123", 3000], w.UNEXPOSE_PAYLOAD)
add(
    "sandboxes",
    "create_image_build",
    [{"image_name": "app", "input_sha256": "a" * 64, "input_size_bytes": 100}],
    w.IMAGE_BUILD_CREATE_PAYLOAD,
    node_args=[{"imageName": "app", "inputSha256": "a" * 64, "inputSizeBytes": 100}],
)
add(
    "sandboxes",
    "complete_image_build",
    [
        "b",
        {
            "input_sha256": "a" * 64,
            "input_size_bytes": 100,
            "input_format": "rootfs_export_tar_gz",
        },
    ],
    w.IMAGE_BUILD_PAYLOAD,
    node_args=[
        "b",
        {
            "inputSha256": "a" * 64,
            "inputSizeBytes": 100,
            "inputFormat": "rootfs_export_tar_gz",
        },
    ],
)
add("sandboxes", "get_image_build", ["b"], w.IMAGE_BUILD_PAYLOAD)
add("sandboxes", "cancel_image_build", ["b"], w.IMAGE_BUILD_PAYLOAD)
add(
    "sandboxes",
    "list_image_builds",
    [{"status": "canceled", "limit": 0}],
    w.IMAGE_BUILD_LIST_PAYLOAD,
)
add(
    "sandboxes",
    "reuse_docker_image",
    [
        {
            "image_name": "app",
            "source_image_digest": "sha256:" + "a" * 64,
            "source_platform": "linux/amd64",
            "image_init": {"env": {"A": "1"}, "working_dir": "/app"},
        }
    ],
    {"hit": True, "build": w.IMAGE_BUILD_RECORD},
    node_args=[
        {
            "imageName": "app",
            "sourceImageDigest": "sha256:" + "a" * 64,
            "sourcePlatform": "linux/amd64",
            "imageInit": {"env": {"A": "1"}, "workingDir": "/app"},
        }
    ],
)
volume = {"id": "vol", "name": "cache", "size": "42", "transferAmount": "7"}
add("volumes", "create", [{"name": "cache"}], volume)
add("volumes", "get", ["vol"], volume)
for params in [{}, {"search": "cache", "page": 0, "limit": -1}]:
    add(
        "volumes",
        "list",
        [params],
        {"volumes": [volume], "totalCount": 1, "page": 1, "perPage": 20},
    )
add("volumes", "delete", ["vol"], {"deleted": True, "id": "vol", "name": "cache"})
add(
    "processes",
    "list",
    [],
    w.PROCESS_LIST_PAYLOAD,
    kwargs={
        "status": ["running", "exited"],
        "limit": 10,
        "cursor": "cur",
        "created_after": 100,
        "created_before": 200,
    },
    node_args=[
        {
            "status": ["running", "exited"],
            "limit": 10,
            "cursor": "cur",
            "createdAfter": 100,
            "createdBefore": 200,
        }
    ],
)
add("processes", "get", ["p1"], w.PROCESS_SUMMARY_PAYLOAD)
legacy_summary = {
    **w.PROCESS_SUMMARY_PAYLOAD["process"],
    "exit_code": 0,
    "started_at": 0,
    "completed_at": 2,
}
add("processes", "get", ["p1"], {"process": legacy_summary})
add(
    "processes",
    "list",
    [],
    {"data": [w.PROCESS_SUMMARY_PAYLOAD["process"]], "next_cursor": "next"},
    node_args=[{}],
)
add(
    "processHandle",
    "wait",
    [],
    w.PROCESS_RESULT_PAYLOAD,
    kwargs={"timeout_ms": 250, "timeout_sec": 3},
    node_args=[{"timeoutMs": 250, "timeoutSec": 3}],
)
add(
    "terminalHandle",
    "wait",
    [],
    w.PTY_PAYLOAD,
    kwargs={"timeout_ms": 800, "include_output": True},
    node_args=[{"timeoutMs": 800, "includeOutput": True}],
)
add("terminalHandle", "resize", [30, 100], w.PTY_PAYLOAD)
add("terminalHandle", "signal", ["TERM"], w.PTY_PAYLOAD)

add(
    "terminal",
    "create",
    [
        {
            "command": "bash",
            "use_shell": False,
            "rows": 24,
            "cols": 80,
            "timeout_ms": 1500,
        }
    ],
    w.PTY_PAYLOAD,
    node_args=[
        {
            "command": "bash",
            "useShell": False,
            "rows": 24,
            "cols": 80,
            "timeoutMs": 1500,
        }
    ],
)
add(
    "terminal",
    "get",
    ["pty_1"],
    w.PTY_PAYLOAD,
    kwargs={"include_output": True},
    node_args=["pty_1", True],
)
for subject in ["files", "filesRoot"]:
    add(
        subject,
        "write",
        [
            [
                {
                    "path": "/tmp/a",
                    "data": "YQ==",
                    "encoding": "base64",
                    "append": True,
                    "mode": "600",
                }
            ]
        ],
        w.WRITE_FILE_PAYLOAD,
    )
    add(
        subject,
        "move",
        [],
        w.MOVE_FILE_PAYLOAD,
        kwargs={"source": "/a", "destination": "/b", "overwrite": False},
        node_args=[{"source": "/a", "destination": "/b", "overwrite": False}],
    )
    add(
        subject,
        "get_watch",
        ["watch_1"],
        w.WATCH_PAYLOAD,
        kwargs={"include_events": True},
        node_args=["watch_1", True],
    )
    add(
        subject,
        "upload_url",
        ["/tmp/a"],
        w.UPLOAD_PRESIGN_PAYLOAD,
        kwargs={"expires_in_seconds": 60, "one_time": False},
        node_args=["/tmp/a", {"expiresInSeconds": 60, "oneTime": False}],
    )
    add(
        subject,
        "download_url",
        ["/tmp/a"],
        w.DOWNLOAD_PRESIGN_PAYLOAD,
        kwargs={"expires_in_seconds": 30, "one_time": True},
        node_args=["/tmp/a", {"expiresInSeconds": 30, "oneTime": True}],
    )
    add(
        subject,
        "mkdir",
        ["/dir"],
        {"created": True, "path": "/dir"},
        kwargs={"parents": False, "mode": "750"},
        node_args=["/dir", {"parents": False, "mode": "750"}],
    )
    add(
        subject,
        "delete",
        ["/dir"],
        {},
        kwargs={"recursive": False},
        node_args=["/dir", {"recursive": False}],
    )

original_sync, original_async = httpx.Client, httpx.AsyncClient


def normalize_result(result):
    for attr in ["_detail", "_summary", "_status"]:
        if hasattr(result, attr):
            result = getattr(result, attr)
            break
    if hasattr(result, "model_dump"):
        result = result.model_dump(mode="json", exclude_none=True, exclude_unset=True)
    if isinstance(result, dict):
        special = {
            "mem_mib": "memMiB",
            "disk_size_mib": "diskSizeMiB",
            "memory_mib": "memoryMiB",
            "disk_mib": "diskMiB",
            "builder_memory_mib": "builderMemoryMiB",
            "builder_scratch_mib": "builderScratchMiB",
        }
        return {
            special.get(
                k, k.split("_")[0] + "".join(x.capitalize() for x in k.split("_")[1:])
            ): normalize_result(v)
            for k, v in result.items()
            if v is not None
        }
    if isinstance(result, list):
        return [normalize_result(v) for v in result]
    return result


async def run(case, asynchronous):
    requests = []

    def respond(request):
        reply = (
            D
            if request.method == "GET" and request.url.path == "/api/sandbox/sbx_123"
            else case["response"]
        )
        requests.append(
            {
                "method": request.method,
                "path": request.url.path,
                "query": {
                    key: request.url.params.get_list(key) for key in request.url.params
                },
                "body": json.loads(request.content) if request.content else None,
                "reply": reply,
            }
        )
        return httpx.Response(200, json=reply)

    mock = httpx.MockTransport(respond)
    with patch("httpx.Client", lambda **kw: original_sync(transport=mock, **kw)), patch(
        "httpx.AsyncClient", lambda **kw: original_async(transport=mock, **kw)
    ):
        client = (AsyncHyperbrowser if asynchronous else Hyperbrowser)(
            api_key="local", base_url="http://reference.test"
        )
        connection = RuntimeConnection(
            sandbox_id="s", base_url="http://runtime.test", token="local"
        )

        async def resolve_async(refresh=False):
            return connection

        transport = (
            AsyncRuntimeTransport(resolve_async)
            if asynchronous
            else RuntimeTransport(lambda refresh=False: connection)
        )
        subjects = {
            "sandboxes": client.sandboxes,
            "volumes": client.volumes,
            "processes": (AsyncProcesses if asynchronous else SandboxProcessesApi)(
                transport
            ),
            "terminal": (AsyncTerminal if asynchronous else SandboxTerminalApi)(
                transport, lambda: connection
            ),
            "files": (AsyncFiles if asynchronous else SandboxFilesApi)(
                transport, lambda: connection
            ),
        }
        subjects["filesRoot"] = subjects["files"].with_run_as("root")
        subjects["processHandle"] = (
            w.AsyncSandboxProcessHandle if asynchronous else w.SandboxProcessHandle
        )(transport, w.SandboxProcessSummary(**w.PROCESS_SUMMARY_PAYLOAD["process"]))
        terminal_module = __import__(
            "hyperbrowser.client.managers."
            + ("async_manager" if asynchronous else "sync_manager")
            + ".sandboxes.sandbox_terminal",
            fromlist=["SandboxTerminalHandle"],
        )
        subjects["terminalHandle"] = terminal_module.SandboxTerminalHandle(
            transport, lambda: connection, SandboxTerminalStatus(**w.PTY_PAYLOAD["pty"])
        )
        try:
            result = getattr(subjects[case["subject"]], case["method"])(
                *case["args"], **case["kwargs"]
            )
            if inspect.isawaitable(result):
                result = await result
        finally:
            closed = client.close()
            if inspect.isawaitable(closed):
                await closed
    return requests, normalize_result(result)


for case in scenarios:
    expected, result = asyncio.run(run(case, False))
    assert (expected, result) == asyncio.run(run(case, True)), case["name"]
    case["requests"] = expected
    case["expectedResult"] = result
    del case["args"]
    del case["kwargs"]
    del case["method"]
out = Path(__file__).resolve().parents[1] / "fixtures/python_wire_reference.json"
out.write_text(json.dumps(scenarios, indent=2) + "\n")
print(f"Wrote {len(scenarios)} HTTP scenarios verified with both Python clients")
