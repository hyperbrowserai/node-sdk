"""Regenerate deterministic fixtures using the pinned Python SDK checkout.

Run with that checkout's venv interpreter, passing its path as the sole argument.
No network or credentials are used. Both source tests and implementations are read.
"""

import importlib.util
import json
from pathlib import Path
import sys

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


def module(name):
    spec = importlib.util.spec_from_file_location(name, root / "tests" / (name + ".py"))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def cases(fn):
    for mark in fn.pytestmark:
        if mark.name == "parametrize":
            for value in mark.args[1]:
                yield value.values if hasattr(value, "values") else value


from hyperbrowser.client.managers.sandboxes.dockerignore import DockerIgnoreMatcher
from hyperbrowser.client.managers.sandboxes.dockerfile_analysis import (
    analyze_dockerfile_sources,
)

ignore_tests = module("test_dockerignore")
patterns = []
for test in [
    ignore_tests.test_moby_pattern_matrix,
    ignore_tests.test_ordered_patterns_and_negations,
]:
    for pattern, path, expected in cases(test):
        assert DockerIgnoreMatcher.from_text(pattern).matches(path) == expected
        patterns.append({"pattern": pattern, "path": path, "expected": expected})
# Unicode outside the BMP is one character in Python/Go, too.
for pattern, path in [
    ("a?b", "a😀b"),
    ("a??b", "a😀b"),
    ("a[^x]b", "a😀b"),
    ("a]b", "a]b"),
]:
    patterns.append(
        {
            "pattern": pattern,
            "path": path,
            "expected": DockerIgnoreMatcher.from_text(pattern).matches(path),
        }
    )
invalid = list(cases(ignore_tests.test_invalid_patterns_are_rejected_at_load_time))
analysis = []
for dockerfile, groups, fallback in cases(
    module("test_dockerfile_analysis").test_analyze_dockerfile_sources
):
    actual = analyze_dockerfile_sources(dockerfile.encode())
    assert actual == (groups, fallback)
    analysis.append({"dockerfile": dockerfile, "groups": groups, "fallback": fallback})
out = Path(__file__).resolve().parents[1] / "fixtures" / "python_reference.json"
out.write_text(
    json.dumps(
        {
            "reference": "python-sdk c36d3d9 / 1.9.1",
            "ignore": patterns,
            "invalidIgnore": invalid,
            "dockerfile": analysis,
        },
        indent=2,
        ensure_ascii=False,
    )
    + "\n"
)
print(
    f"Wrote {len(patterns)} ignore cases, {len(invalid)} invalid patterns, {len(analysis)} Dockerfile cases"
)

from hyperbrowser.image_builds import image_build_name

names = []
for source in ["dockerfile", "prebuilt"]:
    common = {
        "source": source,
        "fingerprint": ("sha256:" if source == "prebuilt" else "") + "a" * 64,
    }
    variants = [
        {},
        {"name_prefix": "custom"},
        {"name_prefix": "x" * 21},
        {"platform": " LINUX/AMD64 "},
        {"platform": "linux/arm64"},
        {"image_config_user": " 1000 "},
        {"image_config_user": ""},
        {"image_init": {}},
        {"image_init": {"env": {}}},
        {
            "image_init": {
                "command": "start",
                "args": ["", "hello"],
                "working_dir": "/app",
            }
        },
        {"image_init": {"env": {"B": "2", "A": "1"}}},
        {"image_init": {"env": {"10": "ten", "2": "two", "__proto__": "literal"}}},
        {"image_init": {"env": {"A": "\x7f😀ü", "😀": "x", "\uffff": "y"}}},
    ]
    for variant in variants:
        options = {**common, **variant}
        node = {
            {
                "name_prefix": "namePrefix",
                "image_init": "imageInit",
                "image_config_user": "imageConfigUser",
            }.get(k, k): v
            for k, v in options.items()
        }
        if "imageInit" in node:
            node["imageInit"] = {
                ("workingDir" if k == "working_dir" else k): v
                for k, v in node["imageInit"].items()
            }
        names.append({"options": node, "expected": image_build_name(**options)})

from hyperbrowser.client.managers.sandboxes.process_output import ProcessOutput
from hyperbrowser.exceptions import HyperbrowserError
import base64


def output(seq, data, stream="stdout"):
    return {
        "event": "output",
        "data": {
            "seq": seq,
            "stream": stream,
            "data": base64.b64encode(data).decode(),
            "encoding": "base64",
            "timestamp": 1,
        },
    }


def done(seq, **extra):
    return {
        "event": "done",
        "data": {
            "id": "p",
            "status": "exited",
            "exit_code": 7,
            "started_at": 1,
            "completed_at": 2,
            "last_seq": seq,
            **extra,
        },
    }


processes = []
# Every byte-boundary partition of a UTF-8 sequence, including a truncated tail.
for raw in [b"abc", "€😀".encode(), b"\xff\xe2\x82"]:
    for mask in range(1 << (len(raw) - 1)):
        pieces = []
        start = 0
        for i in range(len(raw) - 1):
            if mask & (1 << i):
                pieces.append(raw[start : i + 1])
                start = i + 1
        pieces.append(raw[start:])
        events = [output(i + 1, part) for i, part in enumerate(pieces)] + [
            done(len(pieces))
        ]
        processes.append(
            {"name": f"UTF8 {raw.hex()} split {mask}", "events": events, "limit": 100}
        )
for label, events, limit in [
    (
        "system stderr interleave",
        [
            output(1, b"a", "stderr"),
            output(2, b"b", "system"),
            output(3, b"c"),
            done(3),
        ],
        100,
    ),
    ("gap", [output(2, b"x"), done(2)], 100),
    ("duplicate", [output(1, b"x"), output(1, b"y"), done(1)], 100),
    ("missing tail", [output(1, b"x"), done(2)], 100),
    (
        "missing last seq",
        [{"event": "done", "data": {"id": "p", "status": "exited", "started_at": 1}}],
        100,
    ),
    ("truncation", [done(0, output_truncated=True)], 100),
    ("limit exact", [output(1, b"abc"), done(1)], 3),
    ("limit exceeded", [output(1, b"abcd"), done(1)], 3),
    ("unknown stream", [output(1, b"x", "unknown"), done(1)], 100),
    ("prototype stream", [output(1, b"x", "toString"), done(1)], 100),
    (
        "server error",
        [{"event": "error", "data": {"error": "failed", "code": "receiver_failure"}}],
        100,
    ),
]:
    processes.append({"name": label, "events": events, "limit": limit})
for case in processes:
    collected = ProcessOutput("p", case["limit"])
    try:
        for event in case["events"]:
            collected.consume(event)
        case["expected"] = {
            "stdout": collected.result.stdout,
            "stderr": collected.result.stderr,
            "exitCode": collected.result.exit_code,
            "lastSeq": collected.result.last_seq,
        }
    except HyperbrowserError as error:
        case["error"] = {"code": error.code, "details": error.details}
reference = json.loads(out.read_text())
reference.update(imageNames=names, processes=processes)
out.write_text(json.dumps(reference, indent=2, ensure_ascii=False) + "\n")
print(f"Added {len(names)} image identities and {len(processes)} process event cases")

from tempfile import TemporaryDirectory
from hyperbrowser.build_context import docker_build_context_fingerprint

contexts = []
base = {
    "Dockerfile": "FROM scratch\nCOPY app /app\nCOPY link /link\n",
    ".dockerignore": "**/*.log\napp/cache\n",
    "app/main.py": "print('hello')\n",
    "app/debug.log": "ignored",
    "target": "one\n",
    "other": "one\n",
    "unused": "unused",
}
variants = [
    "baseline",
    "contents",
    "same-size",
    "mode",
    "path",
    "ignored-file",
    "ignored-tree",
    "unused-directory",
    "included-directory",
    "symlink-target",
    "symlink-retarget",
    "dockerfile-ignore",
    "ignored-dockerfile-target",
    "external-broken-links",
    "unicode-paths",
    "unicode-ignore",
]
for name in variants:
    files = dict(base)
    modes = {}
    dirs = ["app", "app/cache"]
    links = {"link": "target"}
    if name == "contents":
        files["app/main.py"] = "changed\n"
    elif name == "same-size":
        files["app/main.py"] = files["app/main.py"].replace("hello", "world")
    elif name == "mode":
        modes["app/main.py"] = 0o755
    elif name == "path":
        files["app/renamed.py"] = files.pop("app/main.py")
    elif name == "ignored-file":
        files["app/debug.log"] = "changed"
    elif name == "ignored-tree":
        files["app/cache/ignored"] = "changed"
    elif name == "unused-directory":
        dirs.append("empty")
    elif name == "included-directory":
        dirs.append("app/empty")
    elif name == "symlink-target":
        files["target"] = "two\n"
    elif name == "symlink-retarget":
        links["link"] = "other"
    elif name == "dockerfile-ignore":
        files["Dockerfile.dockerignore"] = "*\n!app/main.py\n"
        files[".dockerignore"] = "app/main.py\n"
    elif name == "ignored-dockerfile-target":
        files["ActualDockerfile"] = files.pop("Dockerfile")
        links["Dockerfile"] = "ActualDockerfile"
        files[".dockerignore"] = "ActualDockerfile\n"
    elif name == "external-broken-links":
        links.update(
            {"app/external": "/external/does-not-exist", "app/broken": "missing"}
        )
    elif name == "unicode-paths":
        files.update(
            {
                "app/a\x7f": "DEL",
                "app/😀": "astral",
                "app/ü": "accent",
                # Above UTF-16 surrogate values, but a valid macOS filename.
                "app/\ue000": "private-use BMP",
            }
        )
    elif name == "unicode-ignore":
        files.update({"app/a😀b": "emoji", "app/axb": "ASCII"})
        files[".dockerignore"] += "\napp/a?b\n"
    for full in [False, True]:
        with TemporaryDirectory() as tmp:
            context = Path(tmp)
            for directory in dirs:
                (context / directory).mkdir(parents=True, exist_ok=True)
            for file, content in files.items():
                p = context / file
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(content)
                p.chmod(modes.get(file, 0o644))
            for directory in context.rglob("*"):
                if directory.is_dir():
                    directory.chmod(0o755)
            for link, target in links.items():
                (context / link).symlink_to(target)
                if sys.platform == "darwin":
                    (context / link).lchmod(0o777)
            expected = docker_build_context_fingerprint(
                context, force_full_context=full
            )
        contexts.append(
            {
                "name": f"{name} full={full}",
                "files": files,
                "modes": modes,
                "directories": dirs,
                "links": links,
                "full": full,
                "expected": expected,
            }
        )
reference = json.loads(out.read_text())
reference["contexts"] = contexts
out.write_text(json.dumps(reference, indent=2, ensure_ascii=False) + "\n")
print(f"Added {len(contexts)} filesystem fingerprint cases")

from hyperbrowser.client.managers.sandboxes.image_build import (
    _derive_auto_image_init,
    merge_image_init,
)
from hyperbrowser.models import SandboxImageInit

configs = [
    {},
    {
        "Env": ["PATH=/usr/bin", "HOME=/root", "APP=1", "SANDBOX_ENABLED=x"],
        "Entrypoint": ["node"],
        "Cmd": ["app.js"],
        "WorkingDir": " /app ",
    },
    {
        "Env": [
            "__proto__=literal",
            "toString=value",
            "A=first",
            "A=last",
            "9BAD=no",
            "NOEQUAL",
            " x = hi=there",
        ],
        "Cmd": ["", "run", ""],
    },
    {"Env": None, "Cmd": None, "WorkingDir": None},
]
inits = []
for config in configs:
    automatic = _derive_auto_image_init(config)
    for explicit in [
        None,
        {},
        {"env": {"APP": "override"}, "working_dir": "/other"},
        {"command": " run "},
        {"args": ["", "--flag"]},
    ]:
        value = merge_image_init(
            automatic, None if explicit is None else SandboxImageInit(**explicit)
        )
        node = (
            None
            if explicit is None
            else {
                ("workingDir" if k == "working_dir" else k): v
                for k, v in explicit.items()
            }
        )
        inits.append(
            {
                "config": config,
                "explicit": node,
                "automatic": None
                if automatic is None
                else automatic.model_dump(by_alias=True, exclude_none=True),
                "expected": None
                if value is None
                else value.model_dump(by_alias=True, exclude_none=True),
            }
        )
reference = json.loads(out.read_text())
reference["imageInit"] = inits
out.write_text(json.dumps(reference, indent=2, ensure_ascii=False) + "\n")
print(f"Added {len(inits)} Docker initialization cases")
