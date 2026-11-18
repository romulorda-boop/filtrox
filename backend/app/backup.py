from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterator, Mapping
from urllib.parse import parse_qsl, unquote, urlsplit


_AGE_RECIPIENT = re.compile(r"age1[a-z0-9]{20,100}\Z")
_SAFE_ENV_KEYS = ("LANG", "LC_ALL", "TZ")
_TRUSTED_BIN_PATH = "/usr/bin:/bin"
_ALLOWED_DB_QUERY = {
    "sslmode",
    "sslrootcert",
    "sslcert",
    "sslkey",
    "connect_timeout",
    "application_name",
    "target_session_attrs",
}


class BackupError(RuntimeError):
    """Safe-to-display backup error; never includes a DSN or subprocess output."""


@dataclass(frozen=True)
class BackupConfiguration:
    recipient: str
    age_binary: str
    pg_dump_binary: str
    pg_environment: Mapping[str, str]
    age_environment: Mapping[str, str]
    pgpass_fd: int | None = field(default=None, repr=False)


class EncryptedBackupStream:
    """Pipe pg_dump directly through age and expose only ciphertext to the caller."""

    def __init__(self, config: BackupConfiguration, *, chunk_size: int = 64 * 1024):
        self.config = config
        self.chunk_size = chunk_size
        self.dump: subprocess.Popen[bytes] | None = None
        self.encrypt: subprocess.Popen[bytes] | None = None
        self._closed = False
        try:
            self.dump = subprocess.Popen(
                [config.pg_dump_binary, "--format=custom", "--no-owner", "--no-acl", "--no-password"],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                env=dict(config.pg_environment),
                pass_fds=(config.pgpass_fd,) if config.pgpass_fd is not None else (),
            )
            if self.dump.stdout is None:
                raise BackupError("O backup não pôde iniciar o fluxo seguro.")
            self.encrypt = subprocess.Popen(
                [config.age_binary, "--recipient", config.recipient],
                stdin=self.dump.stdout,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                env=dict(config.age_environment),
            )
            self.dump.stdout.close()
            if self.encrypt.stdout is None:
                raise BackupError("A criptografia não pôde iniciar o fluxo seguro.")
        except BackupError:
            self.close()
            raise
        except Exception:
            self.close()
            raise BackupError("Não foi possível iniciar a exportação criptografada.") from None

    def __iter__(self) -> Iterator[bytes]:
        try:
            if self.encrypt is None or self.encrypt.stdout is None:
                raise BackupError("A exportação criptografada não está disponível.")
            while True:
                chunk = self.encrypt.stdout.read(self.chunk_size)
                if not chunk:
                    break
                yield chunk

            encryption_status = self.encrypt.wait()
            dump_status = self.dump.wait() if self.dump is not None else 1
            if encryption_status != 0 or dump_status != 0:
                raise BackupError("A exportação criptografada falhou; o dump não foi gravado em disco.")
        except BackupError:
            raise
        except Exception:
            raise BackupError("A exportação criptografada foi interrompida; nenhum dump em claro foi gravado em disco.") from None
        finally:
            self.close()

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        _stop_process(self.encrypt)
        _stop_process(self.dump)
        for process in (self.encrypt, self.dump):
            if process is not None:
                for pipe in (process.stdin, process.stdout, process.stderr):
                    if pipe is not None:
                        try:
                            pipe.close()
                        except Exception:
                            pass
        _close_configuration(self.config)


def _safe_environment(source: Mapping[str, str]) -> dict[str, str]:
    # Use a fixed system PATH; never inherit DATABASE_URL, PG* settings, or secrets.
    result = {"PATH": _TRUSTED_BIN_PATH}
    for key in _SAFE_ENV_KEYS:
        value = source.get(key, "")
        if value and "\x00" not in value:
            result[key] = value
    return result


def _pgpass_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace(":", "\\:")


def _postgres_environment(dsn: str, source: Mapping[str, str]) -> tuple[dict[str, str], bytes | None]:
    try:
        parsed = urlsplit(dsn)
        host = parsed.hostname
        port = parsed.port
        pairs = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
    except (ValueError, UnicodeError):
        raise BackupError("DATABASE_URL não tem um formato PostgreSQL aceito.") from None

    if parsed.scheme not in {"postgres", "postgresql"} or not host or not parsed.username:
        raise BackupError("DATABASE_URL precisa apontar para um PostgreSQL com host e usuário.")
    database = unquote(parsed.path.lstrip("/"))
    if not database:
        raise BackupError("DATABASE_URL precisa identificar o banco de dados.")

    parameters: dict[str, str] = {}
    for key, value in pairs:
        key = key.casefold()
        if key not in _ALLOWED_DB_QUERY or key in parameters:
            raise BackupError("DATABASE_URL contém uma opção de conexão não permitida.")
        parameters[key] = value
    if parameters.get("sslmode") != "verify-full":
        raise BackupError("Backups exigem sslmode=verify-full no DATABASE_URL.")
    timeout = parameters.get("connect_timeout", "10")
    if not timeout.isdecimal() or not 1 <= int(timeout) <= 120:
        raise BackupError("DATABASE_URL contém um connect_timeout inválido.")

    username = unquote(parsed.username)
    password = unquote(parsed.password) if parsed.password is not None else None
    port_text = str(port or 5432)
    fields = (host, database, username, password or "")
    if any(any(ord(char) < 0x20 or ord(char) == 0x7F for char in value) for value in fields):
        raise BackupError("DATABASE_URL contém um valor inválido.")
    if any(value == "*" for value in (host, database, username)):
        raise BackupError("DATABASE_URL contém um campo não permitido para autenticação PostgreSQL.")

    env = _safe_environment(source)
    env.update({
        "PGHOST": host,
        "PGDATABASE": database,
        "PGUSER": username,
        "PGPORT": port_text,
        "PGSSLMODE": "verify-full",
        "PGCONNECT_TIMEOUT": timeout,
        "PGPASSFILE": os.devnull,
    })
    for query_key, pg_key in (
        ("sslrootcert", "PGSSLROOTCERT"),
        ("sslcert", "PGSSLCERT"),
        ("sslkey", "PGSSLKEY"),
        ("application_name", "PGAPPNAME"),
        ("target_session_attrs", "PGTARGETSESSIONATTRS"),
    ):
        if query_key in parameters:
            env[pg_key] = parameters[query_key]
    passfile_entry = None
    if password is not None:
        escaped = (host, port_text, database, username, password)
        passfile_entry = (":".join(_pgpass_escape(value) for value in escaped) + "\n").encode("utf-8")
    return env, passfile_entry


def _memory_passfile(entry: bytes) -> int:
    """Keep PostgreSQL credentials in an anonymous, owner-only in-memory file."""
    create_memfd = getattr(os, "memfd_create", None)
    if create_memfd is None or not os.path.isdir("/proc/self/fd"):
        raise BackupError("Este sistema não oferece passfile anônimo em memória; credenciais não serão expostas em ambiente ou disco.")
    fd: int | None = None
    try:
        fd = create_memfd("filtrox-pgpass", getattr(os, "MFD_CLOEXEC", 0))
        os.fchmod(fd, 0o600)
        offset = 0
        while offset < len(entry):
            offset += os.write(fd, entry[offset:])
        os.lseek(fd, 0, os.SEEK_SET)
        return fd
    except Exception:
        if fd is not None:
            os.close(fd)
        raise BackupError("Não foi possível preparar autenticação PostgreSQL em memória.") from None


def _trusted_executable(name: str) -> str | None:
    """Resolve only root-owned executables under non-writable system directories."""
    found = shutil.which(name, path=_TRUSTED_BIN_PATH)
    if not found:
        return None
    try:
        executable = os.path.realpath(found)
        info = os.stat(executable)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or (stat.S_IMODE(info.st_mode) & 0o022) or not (info.st_mode & 0o111):
            return None
        parent = os.path.dirname(executable)
        while True:
            parent_info = os.stat(parent)
            if not stat.S_ISDIR(parent_info.st_mode) or parent_info.st_uid != 0 or (stat.S_IMODE(parent_info.st_mode) & 0o022):
                return None
            next_parent = os.path.dirname(parent)
            if next_parent == parent:
                break
            parent = next_parent
        return executable
    except OSError:
        return None


def load_configuration(*, environ: Mapping[str, str] | None = None) -> BackupConfiguration:
    """Validate tools, public age recipient, TLS and PostgreSQL settings without connecting."""
    source = os.environ if environ is None else environ
    recipient = source.get("FILTROX_BACKUP_AGE_RECIPIENT", "").strip()
    if not _AGE_RECIPIENT.fullmatch(recipient):
        raise BackupError("Chave pública age ausente ou inválida; configure FILTROX_BACKUP_AGE_RECIPIENT no backend aprovado.")

    dsn = source.get("DATABASE_URL", "").strip()
    if not dsn:
        raise BackupError("DATABASE_URL não está configurada no ambiente do backend.")
    pg_environment, passfile_entry = _postgres_environment(dsn, source)

    age_binary = _trusted_executable("age")
    pg_dump_binary = _trusted_executable("pg_dump")
    if not age_binary or not pg_dump_binary:
        raise BackupError("As ferramentas age e pg_dump precisam estar instaladas em caminhos de sistema confiáveis.")

    pass_fd: int | None = None
    try:
        if passfile_entry is not None:
            pass_fd = _memory_passfile(passfile_entry)
            pg_environment["PGPASSFILE"] = f"/proc/self/fd/{pass_fd}"
        return BackupConfiguration(
            recipient=recipient,
            age_binary=age_binary,
            pg_dump_binary=pg_dump_binary,
            pg_environment=pg_environment,
            age_environment=_safe_environment(source),
            pgpass_fd=pass_fd,
        )
    except Exception:
        if pass_fd is not None:
            os.close(pass_fd)
        raise


def _close_configuration(config: BackupConfiguration) -> None:
    if config.pgpass_fd is not None:
        try:
            os.close(config.pgpass_fd)
        except OSError:
            pass


def _stop_process(process: subprocess.Popen[bytes] | None) -> None:
    if process is not None and process.poll() is None:
        try:
            process.terminate()
            process.wait(timeout=5)
        except Exception:
            try:
                process.kill()
                process.wait(timeout=5)
            except Exception:
                pass


def backup_filename() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"filtrox-postgres-{stamp}-{uuid.uuid4().hex[:12]}.dump.age"
