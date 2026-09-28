"""Capture Python sync/async SSE decoding without a network connection."""

import asyncio
import importlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(sys.argv[1]).resolve()
if not subprocess.check_output(
    ["git", "-C", str(root), "rev-parse", "HEAD"], text=True
).startswith("c36d3d9"):
    raise SystemExit("Expected Python reference c36d3d9")
sys.path.insert(0, str(root))
import httpx

fixtures = Path(__file__).resolve().parents[1] / "fixtures"
cases = [
    {"name": c["name"], "chunks": [x.encode().hex() for x in c["chunks"]]}
    for c in json.loads((fixtures / "sse_line_endings.json").read_text())
]
for name, payload in [
    (
        "comments and unknown fields",
        ": heartbeat\nretry: 12\nunknown: ignored\n\ndata: ok\n\n",
    ),
    ("multiline data", "event: text\nid: cursor\ndata: one\ndata: two\n\n"),
    ("empty fields", "event\nid\ndata\n\n"),
    ("id only", "id: 4\n\n"),
    ("event only", "event: keepalive\n\n"),
    ("reset metadata", "id: a\nevent: one\ndata: 1\n\ndata: false\n\n"),
    ("JSON values", "data: null\n\ndata: [1,2]\n\ndata: true\n\n"),
    ("leading tab preserved", "data:\ttext\n\n"),
    ("all empty lines", "\r\n\r\n\n"),
    ("empty input", ""),
]:
    cases.append({"name": name, "chunks": [payload.encode().hex()]})
payload = 'data: "€😀"\r\n\r\n'.encode()
cases.append(
    {"name": "every UTF8 byte split", "chunks": [bytes([x]).hex() for x in payload]}
)
cases.append({"name": "incomplete UTF8 at EOF", "chunks": [b"data: \xe2".hex()]})


class SyncBytes(httpx.SyncByteStream):
    def __init__(self, chunks):
        self.chunks = chunks

    def __iter__(self):
        yield from self.chunks


class AsyncBytes(httpx.AsyncByteStream):
    def __init__(self, chunks):
        self.chunks = chunks

    async def __aiter__(self):
        for chunk in self.chunks:
            yield chunk


class Client:
    def close(self):
        pass

    async def aclose(self):
        pass


async def decode(case, asynchronous):
    module = importlib.import_module(
        "hyperbrowser.client.managers."
        + ("async_manager" if asynchronous else "sync_manager")
        + ".sandboxes.sandbox_transport"
    )
    transport = module.RuntimeTransport(lambda _: None)
    response = httpx.Response(
        200,
        headers={"content-type": "text/event-stream"},
        stream=(AsyncBytes if asynchronous else SyncBytes)(
            [bytes.fromhex(x) for x in case["chunks"]]
        ),
    )

    async def opened(*a, **kw):
        return Client(), response

    transport._open_stream = (
        opened if asynchronous else lambda *a, **kw: (Client(), response)
    )
    return (
        [item async for item in transport.stream_sse("/stream")]
        if asynchronous
        else list(transport.stream_sse("/stream"))
    )


for case in cases:
    case["expected"] = asyncio.run(decode(case, False))
    assert case["expected"] == asyncio.run(decode(case, True)), case["name"]
(fixtures / "python_sse_reference.json").write_text(
    json.dumps(cases, indent=2, ensure_ascii=False) + "\n"
)
print(f"Wrote {len(cases)} SSE cases verified with both Python transports")
