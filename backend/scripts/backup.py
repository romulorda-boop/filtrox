#!/usr/bin/env python3
"""The former server-side backup CLI is intentionally disabled.

Backups are initiated manually from the authenticated settings page and streamed to
an owner-controlled browser download. This script must never create server copies.
"""

import sys


def main() -> int:
    print(
        "Backup por CLI desativado. Inicie uma exportação manual pela tela autenticada /settings; "
        "o arquivo criptografado será baixado pelo navegador e não ficará armazenado no backend.",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
