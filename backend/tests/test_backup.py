import io
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from app.backup import (
    BackupConfiguration,
    BackupError,
    EncryptedBackupStream,
    _close_configuration,
    _memory_passfile,
    _postgres_environment,
    _safe_environment,
    _trusted_executable,
    backup_filename,
    load_configuration,
)


class BackupTests(unittest.TestCase):
    def test_missing_encryption_fails_closed_before_database_or_filesystem_setup(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            env = {
                "DATABASE_URL": "postgresql://synthetic:synthetic-password@db.test/filtrox?sslmode=verify-full",
            }
            with self.assertRaisesRegex(BackupError, "Chave pública age"):
                load_configuration(environ=env)
            self.assertEqual(list(root.iterdir()), [])

    def test_database_credentials_are_excluded_from_environment_and_encoded_for_passfile(self):
        dsn = "postgresql://synthetic-user:synthetic-pass@db.test:5432/filtrox?sslmode=verify-full&connect_timeout=12"
        env, passfile = _postgres_environment(dsn, {
            "PATH": "/tmp/untrusted-bin",
            "DATABASE_URL": dsn,
            "PGPASSWORD": "inherited-secret",
            "PGOPTIONS": "unsafe inherited option",
            "UNRELATED_SECRET": "not forwarded",
        })
        self.assertEqual(env["PGHOST"], "db.test")
        self.assertEqual(env["PGPORT"], "5432")
        self.assertEqual(env["PGDATABASE"], "filtrox")
        self.assertEqual(env["PGUSER"], "synthetic-user")
        self.assertEqual(env["PGSSLMODE"], "verify-full")
        self.assertEqual(env["PGCONNECT_TIMEOUT"], "12")
        self.assertEqual(env["PGPASSFILE"], os.devnull)
        self.assertNotIn("PGPASSWORD", env)
        self.assertNotIn("DATABASE_URL", env)
        self.assertNotIn("PGOPTIONS", env)
        self.assertNotIn("UNRELATED_SECRET", env)
        self.assertEqual(passfile, b"db.test:5432:filtrox:synthetic-user:synthetic-pass\n")

    def test_memory_passfile_is_owner_only_and_never_created_as_a_path(self):
        entry = b"db.test:5432:synthetic-db:synthetic-user:synthetic-pass\n"
        fd = _memory_passfile(entry)
        try:
            self.assertEqual(stat.S_IMODE(os.fstat(fd).st_mode), 0o600)
            os.lseek(fd, 0, os.SEEK_SET)
            self.assertEqual(os.read(fd, len(entry)), entry)
            self.assertFalse(Path(f"/proc/self/fd/{fd}").resolve().exists())
        finally:
            os.close(fd)

    def test_configuration_requires_no_backup_directory_and_creates_no_server_copy(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            env = {
                "DATABASE_URL": "postgresql://synthetic-user:synthetic-pass@db.test/filtrox?sslmode=verify-full",
                "FILTROX_BACKUP_AGE_RECIPIENT": "age1" + "q" * 32,
                "FILTROX_BACKUP_DIR": str(root / "must-not-be-used"),
            }
            trusted_tools = {name: f"/usr/bin/{name}" for name in ("age", "pg_dump")}
            with patch("app.backup._trusted_executable", side_effect=trusted_tools.get):
                config = load_configuration(environ=env)
            try:
                self.assertIsNotNone(config.pgpass_fd)
                self.assertEqual(config.pg_environment["PGPASSFILE"], f"/proc/self/fd/{config.pgpass_fd}")
                self.assertNotIn("PGPASSWORD", config.pg_environment)
                self.assertEqual(config.age_environment["PATH"], "/usr/bin:/bin")
                self.assertEqual(stat.S_IMODE(os.fstat(config.pgpass_fd).st_mode), 0o600)
                self.assertEqual(list(root.iterdir()), [])
            finally:
                _close_configuration(config)
            with self.assertRaises(OSError):
                os.fstat(config.pgpass_fd)

    def test_safe_environment_ignores_untrusted_path_and_unrelated_values(self):
        env = _safe_environment({
            "PATH": "/tmp/untrusted-bin",
            "HOME": "/tmp/private-home",
            "LANG": "C.UTF-8",
            "DATABASE_URL": "synthetic secret",
            "PGPASSWORD": "synthetic secret",
        })
        self.assertEqual(env, {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"})

    def test_executable_lookup_uses_only_fixed_system_path_and_rejects_user_owned_binary(self):
        with tempfile.TemporaryDirectory() as temp:
            candidate = Path(temp) / "age"
            candidate.write_text("synthetic executable", encoding="utf-8")
            candidate.chmod(0o755)
            with patch("app.backup.shutil.which", return_value=str(candidate)) as which:
                self.assertIsNone(_trusted_executable("age"))
            which.assert_called_once_with("age", path="/usr/bin:/bin")

    def test_database_requires_full_tls_validation_and_rejects_unknown_parameters(self):
        with self.assertRaisesRegex(BackupError, "verify-full"):
            _postgres_environment("postgresql://u:p@db.test/filtrox?sslmode=require", {})
        with self.assertRaisesRegex(BackupError, "não permitida"):
            _postgres_environment("postgresql://u:p@db.test/filtrox?sslmode=verify-full&options=secret", {})

    def _config(self, pgpass_fd=None):
        return BackupConfiguration(
            recipient="age1" + "q" * 32,
            age_binary="/usr/bin/age",
            pg_dump_binary="/usr/bin/pg_dump",
            pg_environment={
                "PATH": "/usr/bin:/bin",
                "PGHOST": "synthetic.invalid",
                "PGDATABASE": "synthetic-db",
                "PGUSER": "synthetic-user",
                "PGPASSFILE": f"/proc/self/fd/{pgpass_fd}" if pgpass_fd is not None else os.devnull,
                "PGSSLMODE": "verify-full",
            },
            age_environment={"PATH": "/usr/bin:/bin"},
            pgpass_fd=pgpass_fd,
        )

    def test_dump_is_piped_directly_to_age_and_only_ciphertext_is_yielded(self):
        dump_stdout = io.BytesIO(b"synthetic plaintext database dump")
        age_stdout = io.BytesIO(b"synthetic age ciphertext")
        dump = Mock(stdout=dump_stdout, wait=Mock(return_value=0), poll=Mock(return_value=0))
        encrypt = Mock(stdout=age_stdout, wait=Mock(return_value=0), poll=Mock(return_value=0))
        with patch("app.backup.subprocess.Popen", side_effect=[dump, encrypt]) as popen:
            stream = EncryptedBackupStream(self._config())
            encrypted_chunks = list(stream)

        self.assertEqual(b"".join(encrypted_chunks), b"synthetic age ciphertext")
        dump_call, age_call = popen.call_args_list
        self.assertEqual(dump_call.args[0], [
            "/usr/bin/pg_dump", "--format=custom", "--no-owner", "--no-acl", "--no-password",
        ])
        self.assertEqual(dump_call.kwargs["stdout"], subprocess.PIPE)
        self.assertIs(age_call.kwargs["stdin"], dump_stdout)
        self.assertEqual(age_call.args[0], ["/usr/bin/age", "--recipient", "age1" + "q" * 32])
        self.assertEqual(age_call.kwargs["stdout"], subprocess.PIPE)
        self.assertIs(dump_call.kwargs["stderr"], subprocess.DEVNULL)
        self.assertIs(age_call.kwargs["stderr"], subprocess.DEVNULL)
        self.assertNotIn("DATABASE_URL", dump_call.kwargs["env"])
        self.assertNotIn("PGPASSWORD", dump_call.kwargs["env"])

    def test_dump_passes_only_anonymous_memory_credential_fd(self):
        entry = b"synthetic.invalid:5432:synthetic-db:synthetic-user:synthetic-pass\n"
        fd = _memory_passfile(entry)
        try:
            dump_stdout = io.BytesIO(b"synthetic dump")
            age_stdout = io.BytesIO(b"synthetic encrypted output")
            dump = Mock(stdout=dump_stdout, wait=Mock(return_value=0), poll=Mock(return_value=0))
            encrypt = Mock(stdout=age_stdout, wait=Mock(return_value=0), poll=Mock(return_value=0))
            with patch("app.backup.subprocess.Popen", side_effect=[dump, encrypt]) as popen:
                stream = EncryptedBackupStream(self._config(fd))
                self.assertEqual(b"".join(stream), b"synthetic encrypted output")
            self.assertEqual(popen.call_args_list[0].kwargs["pass_fds"], (fd,))
            self.assertNotIn("PGPASSWORD", popen.call_args_list[0].kwargs["env"])
            self.assertNotIn("pass_fds", popen.call_args_list[1].kwargs)
        finally:
            try:
                os.close(fd)
            except OSError:
                pass

    def test_failed_dump_never_reports_a_successful_complete_archive(self):
        dump_stdout = io.BytesIO(b"synthetic partial dump")
        age_stdout = io.BytesIO(b"synthetic partial ciphertext")
        dump = Mock(stdout=dump_stdout, wait=Mock(return_value=1), poll=Mock(return_value=1))
        encrypt = Mock(stdout=age_stdout, wait=Mock(return_value=0), poll=Mock(return_value=0))
        with patch("app.backup.subprocess.Popen", side_effect=[dump, encrypt]) as popen:
            stream = EncryptedBackupStream(self._config())
            with self.assertRaisesRegex(BackupError, "falhou"):
                list(stream)
        self.assertEqual(len(popen.call_args_list), 2)

    def test_generated_filename_is_a_plain_attachment_name(self):
        name = backup_filename()
        self.assertRegex(name, r"^filtrox-postgres-\d{8}T\d{6}Z-[0-9a-f]{12}\.dump\.age$")
        self.assertEqual(Path(name).name, name)


if __name__ == "__main__":
    unittest.main()
