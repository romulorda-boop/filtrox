#!/usr/bin/env python3
"""Generate a PBKDF2 password hash for the server's FILTROX_LOGIN_PASSWORD_HASH setting."""

import sys
from getpass import getpass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth import hash_password


def main() -> None:
    first = getpass("Nova senha do FILTROX (mínimo de 12 caracteres): ")
    second = getpass("Repita a senha: ")
    if first != second:
        raise SystemExit("As senhas não coincidem.")
    try:
        print(hash_password(first))
    except ValueError as error:
        raise SystemExit(str(error)) from None


if __name__ == "__main__":
    main()
