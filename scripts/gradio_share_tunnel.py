from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import secrets
import signal
import socket
import stat
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

GRADIO_API_SERVER = "https://api.gradio.app/v3/tunnel-request"
GRADIO_SHARE_SERVER_ADDRESS = os.getenv("GRADIO_SHARE_SERVER_ADDRESS")
FRPC_VERSION = "0.3"
TUNNEL_START_TIMEOUT_SECONDS = 30
DOWNLOAD_TIMEOUT_SECONDS = 30
REMOTE_CONNECT_TIMEOUT_SECONDS = 10
TUNNEL_START_RETRY_COUNT = 3
RETRY_DELAY_SECONDS = 2

CHECKSUMS = {
    "https://cdn-media.huggingface.co/frpc-gradio-0.3/frpc_windows_amd64.exe": "14bc0ea470be5d67d79a07412bd21de8a0a179c6ac1116d7764f68e942dc9ceb",
    "https://cdn-media.huggingface.co/frpc-gradio-0.3/frpc_linux_amd64": "c791d1f047b41ff5885772fc4bf20b797c6059bbd82abb9e31de15e55d6a57c4",
    "https://cdn-media.huggingface.co/frpc-gradio-0.3/frpc_linux_arm64": "823ced25104de6dc3c9f4798dbb43f20e681207279e6ab89c40e2176ccbf70cd",
    "https://cdn-media.huggingface.co/frpc-gradio-0.3/frpc_darwin_amd64": "930f8face3365810ce16689da81b7d1941fda4466225a7bbcbced9a2916a6e15",
    "https://cdn-media.huggingface.co/frpc-gradio-0.3/frpc_darwin_arm64": "dfac50c690aca459ed5158fad8bfbe99f9282baf4166cf7c410a6673fbc1f327",
    "https://cdn-media.huggingface.co/frpc-gradio-0.3/frpc_linux_arm": "4b563beb2e36c448cc688174e20b53af38dc1ff2b5e362d4ddd1401f2affbfb7",
    "https://cdn-media.huggingface.co/frpc-gradio-0.3/frpc_freebsd_386": "cb0a56c764ecf96dd54ed601d240c564f060ee4e58202d65ffca17c1a51ce19c",
    "https://cdn-media.huggingface.co/frpc-gradio-0.3/frpc_freebsd_amd64": "516d9e6903513869a011ddcd1ec206167ad1eb5dd6640d21057acc258edecbbb",
    "https://cdn-media.huggingface.co/frpc-gradio-0.3/frpc_linux_386": "4c2f2a48cd71571498c0ac8a4d42a055f22cb7f14b4b5a2b0d584220fd60a283",
    "https://cdn-media.huggingface.co/frpc-gradio-0.3/frpc_linux_mips": "b309ecd594d4f0f7f33e556a80d4b67aef9319c00a8334648a618e56b23cb9e0",
    "https://cdn-media.huggingface.co/frpc-gradio-0.3/frpc_linux_mips64": "0372ef5505baa6f3b64c6295a86541b24b7b0dbe4ef28b344992e21f47624b7b",
    "https://cdn-media.huggingface.co/frpc-gradio-0.3/frpc_linux_riscv64": "1658eed7e8c14ea76e1d95749d58441ce24147c3d559381832c725c29cfc3df3",
    "https://cdn-media.huggingface.co/frpc-gradio-0.3/frpc_linux_mipsle": "a2aaba16961d3372b79bd7a28976fcd0f0bbaebc2b50d5a7a71af2240747960f",
    "https://cdn-media.huggingface.co/frpc-gradio-0.3/frpc_windows_386.exe": "721b90550195a83e15f2176d8f85a48d5a25822757cb872e9723d4bccc4e5bb6",
    "https://cdn-media.huggingface.co/frpc-gradio-0.3/frpc_linux_mips64le": "796481edd609f31962b45cc0ab4c9798d040205ae3bf354ed1b72fb432d796b8",
}

SCRIPT_DIR = Path(__file__).resolve().parent
RUNTIME_DIR = SCRIPT_DIR.parent / ".mangamaker_runtime" / "gradio"
FRPC_DIR = RUNTIME_DIR / "frpc"
CERTIFICATE_PATH = RUNTIME_DIR / "certificate.pem"


def eprint(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def status(message: str) -> None:
    eprint(f"SHARE_STATUS={message}")


def machine_name() -> str:
    machine = platform.machine().lower()
    aliases = {
        "x86_64": "amd64",
        "amd64": "amd64",
        "aarch64": "arm64",
        "arm64": "arm64",
        "armv7l": "arm",
        "i386": "386",
        "i686": "386",
    }
    return aliases.get(machine, machine)


def frpc_binary_spec() -> tuple[str, str]:
    system_name = platform.system().lower()
    machine = machine_name()
    extension = ".exe" if os.name == "nt" else ""
    remote_name = f"frpc_{system_name}_{machine}{extension}"
    url = f"https://cdn-media.huggingface.co/frpc-gradio-{FRPC_VERSION}/{remote_name}"
    local_name = f"{Path(remote_name).stem}_v{FRPC_VERSION}{extension}"
    return url, local_name


def download(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
        return response.read()


def ensure_frpc_binary() -> Path:
    url, local_name = frpc_binary_spec()
    target = FRPC_DIR / local_name
    FRPC_DIR.mkdir(parents=True, exist_ok=True)

    if not target.exists():
        data = download(url)
        checksum = hashlib.sha256(data).hexdigest()
        expected = CHECKSUMS.get(url)
        if expected and checksum != expected:
            raise RuntimeError(
                f"Downloaded frpc checksum mismatch: expected {expected}, got {checksum}",
            )
        target.write_bytes(data)
        current_mode = target.stat().st_mode
        target.chmod(current_mode | stat.S_IEXEC)

    return target


def fetch_tunnel_config() -> tuple[str, int]:
    if GRADIO_SHARE_SERVER_ADDRESS:
        remote_host, remote_port = GRADIO_SHARE_SERVER_ADDRESS.split(":")
        return remote_host, int(remote_port)
    raw = download(GRADIO_API_SERVER)
    payload = json.loads(raw.decode("utf-8"))[0]
    CERTIFICATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CERTIFICATE_PATH.write_text(payload["root_ca"], encoding="utf-8")
    return payload["host"], int(payload["port"])


def preflight_remote_endpoint(host: str, port: int) -> str:
    status(f"Resolving {host}:{port}...")
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    if not infos:
        raise RuntimeError(f"No socket addresses found for {host}:{port}.")
    resolved_ip = infos[0][4][0]
    status(f"Resolved {host} -> {resolved_ip}. Probing TCP connectivity...")
    with socket.create_connection((host, port), timeout=REMOTE_CONNECT_TIMEOUT_SECONDS):
        pass
    status(f"Remote endpoint {host}:{port} is reachable.")
    return resolved_ip


def start_tunnel_process(
    binary: Path,
    local_host: str,
    local_port: int,
    remote_server_addr: str,
    remote_port: int,
    share_token: str,
) -> subprocess.Popen[bytes]:
    command = [
        str(binary),
        "http",
        "-n",
        share_token,
        "-l",
        str(local_port),
        "-i",
        local_host,
        "--uc",
        "--sd",
        "random",
        "--ue",
        "--server_addr",
        f"{remote_server_addr}:{remote_port}",
        "--disable_log_color",
        "--tls_enable",
        "--tls_trusted_ca_file",
        str(CERTIFICATE_PATH),
    ]
    return subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )


def read_share_url(proc: subprocess.Popen[bytes]) -> str:
    started_at = time.time()
    log_lines: list[str] = []

    while True:
        if proc.poll() is not None:
            raise RuntimeError(
                "Tunnel process exited before share URL was created.\n"
                + "\n".join(log_lines),
            )
        if time.time() - started_at > TUNNEL_START_TIMEOUT_SECONDS:
            raise RuntimeError(
                "Timed out while waiting for Gradio share URL.\n" + "\n".join(log_lines),
            )
        assert proc.stdout is not None
        raw_line = proc.stdout.readline()
        if not raw_line:
          time.sleep(0.1)
          continue
        line = raw_line.decode("utf-8", errors="replace").strip()
        if not line:
            continue
        log_lines.append(line)
        status(f"Tunnel log: {line}")
        if "start proxy success:" in line:
            return line.split("start proxy success:", 1)[1].strip()
        if "login to server failed" in line:
            raise RuntimeError("Gradio tunnel login failed.\n" + "\n".join(log_lines))


def create_tunnel_with_retry(
    *,
    binary: Path,
    local_host: str,
    local_port: int,
    remote_host: str,
    remote_port: int,
) -> tuple[subprocess.Popen[bytes], str]:
    last_error: Exception | None = None
    resolved_ip: str | None = None

    for attempt in range(1, TUNNEL_START_RETRY_COUNT + 1):
        tunnel_proc: subprocess.Popen[bytes] | None = None
        try:
            status(
                f"Tunnel attempt {attempt}/{TUNNEL_START_RETRY_COUNT}: preflighting {remote_host}:{remote_port}...",
            )
            resolved_ip = preflight_remote_endpoint(remote_host, remote_port)
            status(
                f"Tunnel attempt {attempt}/{TUNNEL_START_RETRY_COUNT}: starting frpc login...",
            )
            tunnel_proc = start_tunnel_process(
                binary=binary,
                local_host=local_host,
                local_port=local_port,
                remote_server_addr=remote_host,
                remote_port=remote_port,
                share_token=secrets.token_urlsafe(32),
            )
            share_url = read_share_url(tunnel_proc)
            return tunnel_proc, share_url
        except Exception as error:
            last_error = error if isinstance(error, Exception) else RuntimeError(str(error))
            terminate_process(tunnel_proc)
            error_text = str(last_error)
            should_try_resolved_ip = (
                resolved_ip is not None
                and "lookup " in error_text
                and "i/o timeout" in error_text
            )
            if should_try_resolved_ip:
                status(
                    "frpc failed to resolve the Gradio host even though preflight DNS succeeded. "
                    f"Retrying login with resolved IP {resolved_ip}...",
                )
                try:
                    tunnel_proc = start_tunnel_process(
                        binary=binary,
                        local_host=local_host,
                        local_port=local_port,
                        remote_server_addr=resolved_ip,
                        remote_port=remote_port,
                        share_token=secrets.token_urlsafe(32),
                    )
                    share_url = read_share_url(tunnel_proc)
                    return tunnel_proc, share_url
                except Exception as fallback_error:
                    last_error = (
                        fallback_error
                        if isinstance(fallback_error, Exception)
                        else RuntimeError(str(fallback_error))
                    )
                    terminate_process(tunnel_proc)
            if attempt >= TUNNEL_START_RETRY_COUNT:
                break
            status(
                f"Tunnel attempt {attempt}/{TUNNEL_START_RETRY_COUNT} failed: {last_error}. Retrying in {RETRY_DELAY_SECONDS} seconds...",
            )
            time.sleep(RETRY_DELAY_SECONDS)

    assert last_error is not None
    raise last_error


def terminate_process(proc: subprocess.Popen[bytes] | None) -> None:
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Create a Gradio share tunnel for an existing local web server.",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--ttl-hours", type=float, default=72.0)
    args = parser.parse_args()

    tunnel_proc: subprocess.Popen[bytes] | None = None
    should_exit = False

    def handle_signal(_signum: int, _frame: object | None) -> None:
        nonlocal should_exit
        should_exit = True
        terminate_process(tunnel_proc)

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    try:
        status("Ensuring bundled frpc binary is ready...")
        binary = ensure_frpc_binary()
        status("Requesting Gradio tunnel configuration...")
        remote_host, remote_port = fetch_tunnel_config()
        status(f"Tunnel server assigned: {remote_host}:{remote_port}")
        tunnel_proc, share_url = create_tunnel_with_retry(
            binary=binary,
            local_host=args.host,
            local_port=args.port,
            remote_host=remote_host,
            remote_port=remote_port,
        )
        expires_at = time.time() + max(args.ttl_hours, 0) * 3600
        print(f"SHARE_URL={share_url}", flush=True)
        print(f"SHARE_EXPIRES_AT={int(expires_at)}", flush=True)

        while not should_exit and time.time() < expires_at:
            if tunnel_proc.poll() is not None:
                raise RuntimeError("Gradio tunnel process exited unexpectedly.")
            time.sleep(1)

        terminate_process(tunnel_proc)
        print("SHARE_STOPPED=1", flush=True)
        return 0
    except Exception as error:
        terminate_process(tunnel_proc)
        eprint(
            "SHARE_ERROR="
            + (
                "Gradio public share tunnel failed. The local preview server is still available. "
                f"Details: {error}"
            ),
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
