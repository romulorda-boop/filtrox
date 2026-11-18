from __future__ import annotations

import hashlib
import math
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


@dataclass
class AuthFailure(Exception):
    status_code: int
    public_message: str


@dataclass(frozen=True)
class Principal:
    actor_id: str


def _required_env() -> dict[str, str]:
    values = {
        "issuer": os.getenv("OIDC_ISSUER", "").strip(),
        "audience": os.getenv("OIDC_AUDIENCE", "").strip(),
        "jwks_url": os.getenv("OIDC_JWKS_URL", "").strip(),
        "age_claim": os.getenv("AGE_ASSURANCE_CLAIM", "").strip(),
        "age_value": os.getenv("AGE_ASSURANCE_VALUE", "").strip(),
        "age_timestamp_claim": os.getenv("AGE_ASSURANCE_TIMESTAMP_CLAIM", "").strip(),
        "age_max_age_seconds": os.getenv("AGE_ASSURANCE_MAX_AGE_SECONDS", "").strip(),
        "allowed_subjects": os.getenv("FILTROX_ALLOWED_SUBJECTS", "").strip(),
    }
    if not all(values.values()):
        raise AuthFailure(503, "A autenticação privada e a verificação de idade ainda não estão configuradas.")
    return values


def _verify_age_assurance(claims: dict[str, Any], config: dict[str, str], *, now: float | None = None) -> None:
    actual_age_value = claims.get(config["age_claim"])
    if actual_age_value is None or str(actual_age_value).casefold() != config["age_value"].casefold():
        raise AuthFailure(403, "Não há uma verificação confiável de 18 anos válida para esta conta.")

    try:
        max_age = int(config["age_max_age_seconds"])
        if max_age < 60 or max_age > 90 * 24 * 60 * 60:
            raise ValueError
    except (TypeError, ValueError):
        raise AuthFailure(503, "A validade da verificação de idade ainda não está configurada corretamente.") from None

    raw_timestamp = claims.get(config["age_timestamp_claim"])
    timestamp: float | None = None
    if isinstance(raw_timestamp, bool):
        timestamp = None
    elif isinstance(raw_timestamp, (int, float)):
        timestamp = float(raw_timestamp)
    elif isinstance(raw_timestamp, str):
        try:
            timestamp = float(raw_timestamp)
        except ValueError:
            try:
                parsed = datetime.fromisoformat(raw_timestamp.replace("Z", "+00:00"))
                if parsed.tzinfo is not None:
                    timestamp = parsed.astimezone(timezone.utc).timestamp()
            except (ValueError, OverflowError):
                timestamp = None

    current_time = time.time() if now is None else now
    if timestamp is None or not math.isfinite(timestamp) or timestamp > current_time + 30 or current_time - timestamp > max_age:
        raise AuthFailure(403, "A verificação de idade está ausente ou expirada; verifique novamente.")


def verify_bearer_token(authorization: str | None) -> Principal:
    """Fail closed until a selected OIDC identity and age-assurance provider are configured."""
    config = _required_env()
    if not authorization or not authorization.startswith("Bearer "):
        raise AuthFailure(401, "Autenticação necessária.")
    token = authorization[7:].strip()
    if not token or len(token) > 16384:
        raise AuthFailure(401, "Autenticação inválida.")

    try:
        import jwt
        signing_key = jwt.PyJWKClient(config["jwks_url"], timeout=4).get_signing_key_from_jwt(token).key
        claims: dict[str, Any] = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            audience=config["audience"],
            issuer=config["issuer"],
            options={"require": ["exp", "iat", "iss", "sub", "aud"]},
            leeway=30,
        )
    except AuthFailure:
        raise
    except Exception as exc:
        # Never include provider, token, subject, URL, or exception details in the response/log.
        raise AuthFailure(401, "Autenticação inválida ou expirada.") from exc

    subject = str(claims.get("sub") or "")
    allowed = {value.strip() for value in config["allowed_subjects"].split(",") if value.strip()}
    if not subject or subject not in allowed:
        raise AuthFailure(403, "Esta conta não está autorizada.")

    _verify_age_assurance(claims, config)

    return Principal(actor_id=hashlib.sha256(subject.encode("utf-8")).hexdigest())
