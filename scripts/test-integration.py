#!/usr/bin/env python3
"""Run real HTTP integration tests against an isolated local Wrangler + D1.

Requires npm ci and npm run build. Never logs in, deploys, uses production
credentials, or applies remote migrations. Temporary state is removed on exit.
"""
from __future__ import annotations

import http.cookies
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import hashlib
from websocket_client import LocalWebSocket

ROOT = Path(__file__).resolve().parents[1]
WRANGLER = ROOT / "node_modules/.bin/wrangler"
PASSWORD = f"Integration-{secrets.token_urlsafe(24)}"
CHECKS = 0


class Client:
    def __init__(self, origin: str):
        self.origin = origin
        self.cookies: dict[str, str] = {}

    def request(self, method: str, path: str, data=None, status=200, origin=None, omit_origin=False):
        global CHECKS
        headers = {"Origin": origin or self.origin, "Accept": "application/json" if path.startswith("/api/") else "text/html"}
        if omit_origin:
            headers.pop("Origin")
        if not path.startswith("/api/") and method == "GET":
            headers["Sec-Fetch-Mode"] = "navigate"
        if self.cookies:
            headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in self.cookies.items())
        payload = None if data is None else json.dumps(data).encode()
        if payload is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.origin + path, payload, headers, method=method)
        try:
            response = urllib.request.urlopen(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        content = response.read().decode()
        expected = status if isinstance(status, tuple) else (status,)
        assert response.status in expected, f"{method} {path}: expected {status}, got {response.status}: {content[:300]}"
        for line in response.headers.get_all("Set-Cookie", []):
            parsed = http.cookies.SimpleCookie()
            parsed.load(line)
            for name, cookie in parsed.items():
                if cookie["max-age"] == "0":
                    self.cookies.pop(name, None)
                else:
                    self.cookies[name] = cookie.value
        CHECKS += 1
        value = json.loads(content) if "application/json" in response.headers.get("Content-Type", "") else content
        return value, response.headers


def test_websocket_sessions(origin, alice, bob, local_sql):
    sockets = []

    def connect(client, path):
        socket = LocalWebSocket(client, path)
        sockets.append(socket)
        return socket

    try:
        print("Testing live local WebSocket revocation and expiry...", flush=True)
        bob.request("PATCH", "/api/settings/preferences", {"allowIncoming": True})
        secondary = Client(origin)
        secondary.request("POST", "/api/auth/login", {"username": "alice", "password": PASSWORD})
        primary_presence = connect(alice, "/api/presence")
        secondary_presence = connect(secondary, "/api/presence")
        data, _ = alice.request("POST", "/api/calls", {"number": "casenumber"}, status=201)
        call_id = data["callId"]
        primary_signal = connect(alice, f"/api/calls/{call_id}/signaling")
        primary_signal.expect("call-state")
        alice.request("POST", "/api/auth/logout", {})
        primary_presence.expect_invalid()
        primary_signal.expect_invalid()
        secondary_presence.send_json({"type": "ping"})
        secondary_presence.expect("pong")
        secondary.request("POST", f"/api/calls/{call_id}/cancel", {})

        # The alarm must close an idle socket without waiting for another ping.
        secondary_presence.close()
        data, _ = secondary.request("POST", "/api/calls", {"number": "casenumber"}, status=201)
        call_id = data["callId"]
        token_hash = hashlib.sha256(secondary.cookies["sc_session"].encode()).hexdigest()
        local_sql(f"UPDATE sessions SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+4 seconds') WHERE token_hash='{token_hash}'")
        expiry_presence = connect(secondary, "/api/presence")
        expiry_signal = connect(secondary, f"/api/calls/{call_id}/signaling")
        expiry_signal.expect("call-state")
        expiry_presence.expect_invalid()
        expiry_signal.expect_invalid()
        secondary.request("GET", "/api/me", status=401)

        guest = Client(origin)
        data, _ = guest.request("POST", "/api/auth/guest", {}, status=201)
        user_id = data["user"]["id"]
        local_sql(f"UPDATE users SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+4 seconds') WHERE id='{user_id}'")
        guest_presence = connect(guest, "/api/presence")
        guest_presence.expect_invalid()
        guest.request("GET", "/api/me", status=401)
        print("PASS: live socket logout, session expiry, temporary-user expiry and same-user session isolation.", flush=True)
    finally:
        for socket in sockets:
            socket.close()


def test_public_usage_excludes_expired_users(anonymous, local_sql):
    local_sql("INSERT INTO app_settings(key,value_json,updated_at) VALUES('site_configuration','{\"usage\":{\"showPublicAggregate\":true,\"minimumAggregateUsers\":5}}',strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
    for index in range(4):
        user_id = f"public-active-{index}"
        local_sql(f"INSERT INTO users(id,display_name,is_temporary,expires_at,created_at,updated_at) VALUES('{user_id}','Public active {index}',1,strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
        local_sql(f"INSERT INTO usage_snapshots(id,user_id,month,bytes_used,quota_bytes,authoritative,captured_at) VALUES('snapshot-{index}','{user_id}',strftime('%Y-%m','now'),{index + 1},NULL,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
    local_sql("INSERT INTO users(id,display_name,is_temporary,expires_at,created_at,updated_at) VALUES('public-expired-guest','Expired preview guest',1,strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day'),strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 day'),strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day'))")
    local_sql("INSERT INTO usage_snapshots(id,user_id,month,bytes_used,quota_bytes,authoritative,captured_at) VALUES('snapshot-expired','public-expired-guest',strftime('%Y-%m','now'),999999999,NULL,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'))")

    data, _ = anonymous.request("GET", "/api/usage/public")
    assert data["available"] is False and data["usedBytes"] is None, "Expired accounts must not satisfy the public cohort threshold"

    local_sql("INSERT INTO users(id,display_name,is_temporary,expires_at,created_at,updated_at) VALUES('public-active-4','Public active 4',1,strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
    local_sql("INSERT INTO usage_snapshots(id,user_id,month,bytes_used,quota_bytes,authoritative,captured_at) VALUES('snapshot-4','public-active-4',strftime('%Y-%m','now'),5,NULL,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
    data, _ = anonymous.request("GET", "/api/usage/public")
    assert data["available"] is True and data["usedBytes"] == 15, "The public total must include only five active users and exclude expired usage"
    print("PASS: public aggregate excludes expired users from both cohort and total.", flush=True)


def run():
    assert WRANGLER.exists(), "Run npm ci first"
    assert (ROOT / "apps/web/dist/index.html").exists(), "Run npm run build first"
    # Strip all inherited Cloudflare credentials; only --local commands are used.
    env = {k: v for k, v in os.environ.items() if not k.startswith("CLOUDFLARE_")}
    env.update(CI="1", WRANGLER_SEND_METRICS="false")
    state_root = ROOT / ".wrangler"
    state_root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="integration-", dir=state_root) as temp:
        work = Path(temp)
        config = work / "wrangler.json"
        config.write_text(json.dumps({
            "name": "sparkcall-integration",
            "main": str(ROOT / "workers/api/src/index.ts"),
            "compatibility_date": "2026-11-02",
            "rules": [{"type": "Text", "globs": ["**/*.yaml"], "fallthrough": True}],
            "assets": {"directory": str(ROOT / "apps/web/dist"), "binding": "ASSETS", "not_found_handling": "single-page-application", "run_worker_first": ["/api/*", "/callrecords", "/callrecords/*"]},
            "d1_databases": [{"binding": "DB", "database_name": "sparkcall-integration", "database_id": "00000000-0000-0000-0000-000000000000", "migrations_dir": str(ROOT / "migrations")}],
            "durable_objects": {"bindings": [{"name": "SIGNALING", "class_name": "SparkCallDurableObject"}, {"name": "PRESENCE", "class_name": "SparkCallPresenceObject"}]},
            "exports": {"SparkCallDurableObject": {"type": "durable-object", "storage": "sqlite"}, "SparkCallPresenceObject": {"type": "durable-object", "storage": "sqlite"}},
            "vars": {"INTERNAL_SIGNALING_TOKEN": secrets.token_hex(32)},
        }) + "\n")
        base = [str(WRANGLER)]
        common = ["--local", "--config", str(config), "--persist-to", str(work / "state")]

        def local_sql(sql: str):
            subprocess.run(base + ["d1", "execute", "sparkcall-integration"] + common + ["--command", sql], cwd=work, env=env, check=True, stdout=subprocess.DEVNULL)

        print("Applying migrations to isolated local D1...", flush=True)
        subprocess.run(base + ["d1", "migrations", "apply", "sparkcall-integration"] + common, cwd=work, env=env, check=True, stdout=subprocess.DEVNULL)
        with socket.socket() as port_socket:
            port_socket.bind(("127.0.0.1", 0))
            port = port_socket.getsockname()[1]
        origin = f"http://127.0.0.1:{port}"
        log = (work / "worker.log").open("w+")
        process = subprocess.Popen(base + ["dev"] + common + ["--ip", "127.0.0.1", "--port", str(port)], cwd=work, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            deadline = time.monotonic() + 60
            while True:
                try:
                    urllib.request.urlopen(origin + "/api/session", timeout=1).close()
                    break
                except (OSError, urllib.error.URLError):
                    if process.poll() is not None or time.monotonic() >= deadline:
                        log.seek(0)
                        raise RuntimeError("Local Worker failed to start:\n" + log.read()[-5000:])
                    time.sleep(0.25)
            print("Testing real local HTTP routes...", flush=True)
            anonymous, alice, bob, guest = [Client(origin) for _ in range(4)]
            anonymous.request("GET", "/")
            makecall_html, _ = anonymous.request("GET", "/makecall/Alice")
            assert "<!doctype html>" in makecall_html.lower(), f"Expected SPA HTML for username call link, received {makecall_html[:150]!r}"
            html, headers = anonymous.request("GET", "/callrecords/private-meeting")
            assert "<!doctype html>" in html.lower(), f"Expected SPA HTML, received {html[:150]!r}"
            assert headers.get("X-Robots-Tag") == "noindex, nofollow"
            data, _ = anonymous.request("GET", "/api/session")
            assert data["authenticated"] is False
            anonymous.request("GET", "/api/me", status=401)
            registered = Client(origin)
            registered_username = f"registration-{secrets.token_hex(4)}"
            registered_data, registered_headers = registered.request(
                "POST",
                "/api/auth/register",
                {"username": registered_username, "password": PASSWORD, "displayName": "Integration Account"},
                status=201,
            )
            assert registered_data["user"]["username"] == registered_username
            assert registered_data["user"]["temporary"] is False
            assert "HttpOnly" in registered_headers.get("Set-Cookie", "")
            registered_login = Client(origin)
            login_data, _ = registered_login.request("POST", "/api/auth/login", {"username": registered_username, "password": PASSWORD})
            assert login_data["user"]["id"] == registered_data["user"]["id"]
            anonymous.request("POST", "/api/auth/guest", {}, status=403, origin="https://attacker.invalid")
            anonymous.request("POST", "/api/auth/guest", {}, status=403, omit_origin=True)
            anonymous.request("POST", "/api/calls", {"number": "Nobody"}, status=403, origin="https://attacker.invalid")
            ids = []
            for client in (alice, bob, guest):
                data, headers = client.request("POST", "/api/auth/guest", {}, status=201)
                ids.append(data["user"]["id"])
                assert data["user"]["temporary"] is True
                assert "HttpOnly" in headers.get("Set-Cookie", "")
                assert "SameSite=" in headers.get("Set-Cookie", "")
            guest.request("POST", "/api/numbers", {"number": "GuestCustom"}, status=403)
            for client, username, number, user_id in ((alice, "alice", "CaseNumber", ids[0]), (bob, "bob", "casenumber", ids[1])):
                data, _ = client.request("POST", "/api/auth/upgrade", {"username": username, "password": PASSWORD})
                assert data["user"]["id"] == user_id and data["user"]["temporary"] is False
                client.request("POST", "/api/numbers", {"number": number})
            data, _ = anonymous.request("GET", "/api/numbers/availability?number=CaseNumber")
            assert data["available"] is False
            data, _ = anonymous.request("GET", "/api/numbers/availability?number=CASENUMBER")
            assert data["available"] is True
            local_sql("INSERT INTO reserved_numbers(number) VALUES('LaunchOnly')")
            data, _ = anonymous.request("GET", "/api/numbers/availability?number=launchonly")
            assert data["available"] is False
            data, _ = alice.request("POST", "/api/numbers", {"number": "launchonly"}, status=400)
            assert data["error"]["code"] == "NUMBER_RESERVED"
            alice.request("POST", "/api/numbers", {"number": "OtherNumber"}, status=429)
            alice.request("POST", "/api/contacts", {"number": "casenumber", "name": "Bob", "favorite": True}, status=201)
            data, _ = alice.request("GET", "/api/contacts?q=Bob")
            contact = data["contacts"][0]
            bob.request("GET", f"/api/contacts/{contact['id']}", status=404)
            bob.request("PATCH", f"/api/contacts/{contact['id']}", {"name": "Tampered"})
            data, _ = alice.request("GET", f"/api/contacts/{contact['id']}")
            assert data["contact"]["name"] == "Bob"
            bob.request("POST", "/api/blocked", {"number": "CaseNumber"})
            alice.request("POST", "/api/calls", {"number": "casenumber"}, status=403)
            bob.request("DELETE", "/api/blocked", {"number": "CaseNumber"})
            username_call, _ = alice.request("POST", "/api/calls", {"targetUsername": "BOB"}, status=201)
            assert username_call["userId"] == ids[1]
            alice.request("POST", f"/api/calls/{username_call['callId']}/cancel", {})
            alice_secondary = Client(origin)
            alice_secondary.request("POST", "/api/auth/login", {"username": "alice", "password": PASSWORD})
            baseline, _ = alice.request("GET", "/api/settings/preferences")
            with ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(alice.request, "PATCH", "/api/settings/preferences", {"theme": "dark"})
                second = pool.submit(alice_secondary.request, "PATCH", "/api/settings/preferences", {"bitrateKbps": 64})
                first_result, second_result = first.result()[0], second.result()[0]
            assert {first_result["version"], second_result["version"]} == {baseline["version"] + 1, baseline["version"] + 2}
            latest, _ = alice.request("GET", "/api/settings/preferences")
            assert latest["version"] == baseline["version"] + 2
            assert latest["preferences"]["theme"] == "dark" and latest["preferences"]["bitrateKbps"] == 64
            bob.request("PATCH", "/api/settings/preferences", {"allowIncoming": False, "bitrateMode": "high", "bitrateKbps": 64})
            alice.request("POST", "/api/calls", {"number": "casenumber"}, status=403)
            data, _ = bob.request("GET", "/api/settings/preferences")
            assert data["preferences"]["bitrateKbps"] == 64
            payload = {"slug": "private-meeting", "title": "Private meeting", "expiresAt": None,
                       "participants": [{"displayName": "Consenting", "consent": True}, {"displayName": "Private", "consent": False}],
                       "metadata": {"topic": "Testing", "email": "do-not-publish", "sessionToken": "do-not-publish"}}
            data, _ = alice.request("POST", "/api/records", payload, status=201)
            record_id = data["id"]
            anonymous.request("GET", "/api/records/private-meeting", status=404)
            bob.request("PATCH", f"/api/records/{record_id}", {"isPublic": True}, status=404)
            alice.request("PATCH", f"/api/records/{record_id}", {"isPublic": True})
            data, headers = anonymous.request("GET", "/api/records/PRIVATE-MEETING")
            record = data["record"]
            assert headers.get("X-Robots-Tag") == "noindex, nofollow"
            assert "id" not in record and "owner_id" not in record
            assert record["participants"] == [{"displayName": "Consenting"}]
            assert record["metadata"] == {"topic": "Testing"}
            bob.request("POST", "/api/records", {**payload, "slug": "PRIVATE-MEETING"}, status=409)
            alice.request("PATCH", f"/api/records/{record_id}", {"isPublic": False})
            anonymous.request("GET", "/api/records/private-meeting", status=404)
            alice.request("PATCH", f"/api/records/{record_id}", {"isPublic": True})
            # An ISO timestamp earlier today must expire immediately, not tomorrow.
            local_sql(f"UPDATE records SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute') WHERE id='{record_id}'")
            anonymous.request("GET", "/api/records/private-meeting", status=404)
            alice.request("GET", f"/api/records/{record_id}")
            call_id = secrets.token_hex(16)
            local_sql(f"INSERT INTO call_history(id,caller_id,recipient_id,caller_number,recipient_number,started_at,ended_at,duration_seconds,status,created_at) VALUES('{call_id}','{ids[0]}','{ids[2]}','CaseNumber','Guest',datetime('now','-1 minute'),datetime('now'),42,'ended',datetime('now'))")
            data, headers = guest.request("POST", "/api/records", {"slug": "guest-owned", "title": "Guest owned", "expiresAt": None, "callId": call_id}, status=201)
            guest_record = data["id"]
            assert data["recoveryCapability"] is True and "HttpOnly" in headers.get("Set-Cookie", "")
            guest.request("POST", "/api/auth/logout", {})
            guest.request("GET", "/api/me", status=401)
            guest.request("PATCH", f"/api/records/{guest_record}", {"title": "After logout"})
            # Exercise the same foreign-key action as expired temporary-user cleanup.
            local_sql(f"DELETE FROM users WHERE id='{ids[2]}'")
            data, _ = guest.request("GET", f"/api/records/{guest_record}")
            assert data["record"]["title"] == "After logout"
            assert data["record"]["durationSeconds"] == 42
            assert data["record"]["startedAt"] and data["record"]["endedAt"]
            guest.request("PATCH", f"/api/records/{guest_record}", {"isPublic": True})
            data, _ = anonymous.request("GET", "/api/records/guest-owned")
            assert data["record"]["durationSeconds"] == 42
            guest.request("DELETE", f"/api/records/{guest_record}")
            anonymous.request("GET", "/api/records/guest-owned", status=404)
            alice.request("GET", "/api/turn/credentials", status=503)
            test_public_usage_excludes_expired_users(anonymous, local_sql)
            alice.request("POST", "/api/auth/logout", {})
            alice.request("GET", "/api/me", status=401)
            alice.request("POST", "/api/auth/login", {"username": "alice", "password": "incorrect"}, status=401)
            data, _ = alice.request("POST", "/api/auth/login", {"username": "ALICE", "password": PASSWORD})
            assert data["user"]["id"] == ids[0]
            test_websocket_sessions(origin, alice, bob, local_sql)
            alice.request("POST", "/api/auth/login", {"username": "alice", "password": PASSWORD})
            # A user cannot evade the limit by calling nonexistent numbers.
            limited = False
            for _ in range(11):
                data, _ = alice.request("POST", "/api/calls", {"number": "NoSuchSparkCallNumber"}, status=(404, 429))
                if data["error"]["code"] == "RATE_LIMITED":
                    limited = True
                    break
            assert limited, "Repeated call creation must be rate-limited"
            print(f"PASS: {CHECKS} HTTP assertions, isolated migrations, ownership and expiry regressions.", flush=True)
        finally:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
            log.close()


if __name__ == "__main__":
    run()
