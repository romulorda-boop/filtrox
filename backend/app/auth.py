from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from dataclasses import dataclass
from typing import Any


SESSION_COOKIE_NAME = "filtrox_session"
MIN_PBKDF2_ITERATIONS = 100_000
DEFAULT_PBKDF2_ITERATIONS = 600_000
MAX_PBKDF2_ITERATIONS = 2_000_000
SESSION_IDLE_TTL_SECONDS = 30 * 24 * 60 * 60


@dataclass
class AuthFailure(Exception):
    status_code: int
    public_message: str


@dataclass(frozen=True)
class Principal:
    actor_id: str


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    if not value or any(char not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_" for char in value):
        raise ValueError("invalid base64url")
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _normalize_email(value: str) -> str:
    if not isinstance(value, str):
        return ""
    normalized = value.strip().casefold()
    if len(normalized) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+", normalized):
        return ""
    return normalized


def _required_config() -> dict[str, Any]:
    email = _normalize_email(os.getenv("FILTROX_LOGIN_EMAIL", ""))
    password_hash = os.getenv("FILTROX_LOGIN_PASSWORD_HASH", "").strip()
    secret = os.getenv("FILTROX_SESSION_SECRET", "").encode("utf-8")
    environment = os.getenv("FILTROX_ENVIRONMENT", "development").strip().lower()
    raw_secure = os.getenv("FILTROX_COOKIE_SECURE", "").strip().lower()

    if not email or not password_hash or len(secret) < 32:
        raise AuthFailure(503, "O login privado ainda não está configurado no servidor.")
    if raw_secure and raw_secure not in {"true", "false"}:
        raise AuthFailure(503, "A configuração segura do cookie ainda não está correta.")
    cookie_secure = environment != "development" if not raw_secure else raw_secure == "true"
    if environment == "production" and not cookie_secure:
        raise AuthFailure(503, "O cookie de sessão precisa usar HTTPS em produção.")

    return {
        "email": email,
        "password_hash": password_hash,
        "session_secret": secret,
        "cookie_secure": cookie_secure,
    }


def _parse_password_hash(encoded: str) -> tuple[int, bytes, bytes]:
    try:
        algorithm, raw_iterations, raw_salt, raw_digest = encoded.split("$", 3)
        iterations = int(raw_iterations)
        salt = _b64url_decode(raw_salt)
        expected = _b64url_decode(raw_digest)
        if algorithm != "pbkdf2_sha256" or not MIN_PBKDF2_ITERATIONS <= iterations <= MAX_PBKDF2_ITERATIONS:
            raise ValueError
        if len(salt) < 16 or len(expected) != hashlib.sha256().digest_size:
            raise ValueError
        return iterations, salt, expected
    except (TypeError, ValueError, base64.binascii.Error):
        raise AuthFailure(503, "O hash de senha configurado no servidor é inválido.") from None


def hash_password(password: str, *, iterations: int = DEFAULT_PBKDF2_ITERATIONS, salt: bytes | None = None) -> str:
    """Create a PBKDF2 hash for server configuration; never store the raw password."""
    if not isinstance(password, str) or len(password) < 12 or len(password) > 1024:
        raise ValueError("Use uma senha de 12 a 1024 caracteres.")
    if not MIN_PBKDF2_ITERATIONS <= iterations <= MAX_PBKDF2_ITERATIONS:
        raise ValueError("Número de iterações PBKDF2 fora do intervalo permitido.")
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${_b64url_encode(salt)}${_b64url_encode(digest)}"


def verify_credentials(email: str, password: str) -> Principal:
    """Authenticate the one configured account; there is no signup or account creation path."""
    config = _required_config()
    iterations, salt, expected = _parse_password_hash(config["password_hash"])
    candidate = password if isinstance(password, str) and len(password) <= 1024 else "\0"
    actual = hashlib.pbkdf2_hmac("sha256", candidate.encode("utf-8"), salt, iterations)
    password_ok = hmac.compare_digest(actual, expected)
    normalized_email = _normalize_email(email)
    email_ok = bool(normalized_email) and hmac.compare_digest(
        normalized_email.encode("utf-8"), config["email"].encode("utf-8")
    )
    if not email_ok or not password_ok:
        raise AuthFailure(401, "E-mail ou senha incorretos.")
    actor_id = hashlib.sha256(config["email"].encode("utf-8")).hexdigest()
    return Principal(actor_id=actor_id)


def create_session_token() -> tuple[str, int, bool]:
    config = _required_config()
    now = int(time.time())
    payload = {
        "sub": "owner",
        "iat": now,
        "last_activity": now,
        "exp": now + SESSION_IDLE_TTL_SECONDS,
        "nonce": secrets.token_urlsafe(16),
    }
    encoded_payload = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(config["session_secret"], encoded_payload.encode("ascii"), hashlib.sha256).digest()
    token = f"{encoded_payload}.{_b64url_encode(signature)}"
    return token, SESSION_IDLE_TTL_SECONDS, config["cookie_secure"]


def verify_session_token(token: str | None, *, now: int | None = None) -> Principal:
    if not token:
        raise AuthFailure(401, "Autenticação necessária.")
    if len(token) > 8192:
        raise AuthFailure(401, "Sessão inválida ou expirada.")
    config = _required_config()
    try:
        parts = token.split(".")
        if len(parts) != 2:
            raise ValueError
        encoded_payload, encoded_signature = parts
        supplied_signature = _b64url_decode(encoded_signature)
        expected_signature = hmac.new(
            config["session_secret"], encoded_payload.encode("ascii"), hashlib.sha256
        ).digest()
        if len(supplied_signature) != len(expected_signature) or not hmac.compare_digest(
            supplied_signature, expected_signature
        ):
            raise ValueError
        payload = json.loads(_b64url_decode(encoded_payload))
        if not isinstance(payload, dict) or payload.get("sub") != "owner":
            raise ValueError
        issued_at = payload.get("iat")
        last_activity = payload.get("last_activity")
        expires_at = payload.get("exp")
        if isinstance(issued_at, bool) or not isinstance(issued_at, int):
            raise ValueError
        if isinstance(last_activity, bool) or not isinstance(last_activity, int):
            raise ValueError
        if isinstance(expires_at, bool) or not isinstance(expires_at, int):
            raise ValueError
        current = int(time.time()) if now is None else now
        if issued_at > current + 30 or last_activity < issued_at or last_activity > current + 30:
            raise ValueError
        if expires_at != last_activity + SESSION_IDLE_TTL_SECONDS or expires_at <= current:
            raise ValueError
    except AuthFailure:
        raise
    except Exception:
        raise AuthFailure(401, "Sessão inválida ou expirada.") from None

    actor_id = hashlib.sha256(config["email"].encode("utf-8")).hexdigest()
    return Principal(actor_id=actor_id)


def refresh_session_token(token: str, *, now: int | None = None) -> tuple[str, int, bool]:
    """Slide the idle deadline forward while preserving this device's original sign-in time."""
    verify_session_token(token, now=now)
    config = _required_config()
    current = int(time.time()) if now is None else now
    payload = json.loads(_b64url_decode(token.split(".", 1)[0]))
    payload["last_activity"] = current
    payload["exp"] = current + SESSION_IDLE_TTL_SECONDS
    encoded_payload = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(config["session_secret"], encoded_payload.encode("ascii"), hashlib.sha256).digest()
    refreshed = f"{encoded_payload}.{_b64url_encode(signature)}"
    return refreshed, SESSION_IDLE_TTL_SECONDS, config["cookie_secure"]


def cookie_secure_enabled() -> bool:
    environment = os.getenv("FILTROX_ENVIRONMENT", "development").strip().lower()
    if environment == "production":
        return True
    return os.getenv("FILTROX_COOKIE_SECURE", "false").strip().lower() == "true"
