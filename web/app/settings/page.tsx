'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  Download,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';

type BackupStatus = {
  download_available: boolean;
  restore_available: boolean;
  message: string;
  restore_message: string;
};

export default function SettingsPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [backupLoading, setBackupLoading] = useState(true);
  const [backupError, setBackupError] = useState('');

  const loadBackups = useCallback(async () => {
    setBackupLoading(true);
    setBackupError('');
    try {
      const response = await fetch('/v1/admin/backups', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (response.status === 401) {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.replace(`/login?next=${encodeURIComponent(next)}`);
        return;
      }
      const data = await response.json().catch(() => null) as BackupStatus | null;
      if (!response.ok || !data || typeof data.download_available !== 'boolean') {
        throw new Error('Não foi possível verificar a exportação de backup.');
      }
      setBackupStatus(data);
    } catch (loadError) {
      setBackupError(loadError instanceof Error ? loadError.message : 'Não foi possível conectar ao serviço.');
      setBackupStatus(null);
    } finally {
      setBackupLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError('A confirmação não corresponde à nova senha.');
      return;
    }
    if (newPassword.length < 12) {
      setError('A nova senha precisa ter pelo menos 12 caracteres.');
      return;
    }
    if (currentPassword === newPassword) {
      setError('Escolha uma senha diferente da atual.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/v1/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });

      if (response.ok) {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setSuccess('Senha alterada. As sessões já abertas continuam ativas até a saída local ou 30 dias sem atividade; a troca não encerra sessões remotamente.');
        return;
      }
      if (response.status === 401) {
        setError('A senha atual está incorreta.');
      } else if (response.status === 409) {
        setError('A senha foi alterada em outra sessão. Atualize a página e tente novamente.');
      } else if (response.status === 422) {
        setError('Confira os dados: a nova senha deve ter de 12 a 1024 caracteres e ser diferente da atual.');
      } else if (response.status === 503) {
        setError('A troca depende do PostgreSQL configurado e da migração manual da tabela de credenciais. Esse armazenamento ainda pode não estar disponível.');
      } else {
        setError('Não foi possível alterar a senha. Tente novamente.');
      }
    } catch {
      setError('Não foi possível conectar ao serviço. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="settings-shell">
      <div className="settings-page">
        <header className="settings-header">
          <a className="auth-brand" href="/" aria-label="Voltar ao FILTROX">
            <img src="/filtrox-mark.svg" alt="FILTROX" width="190" height="40" />
          </a>
          <a className="settings-back" href="/"><ArrowLeft size={16} /> Voltar ao FILTROX</a>
        </header>

        <div className="settings-title-block">
          <p className="auth-eyebrow">SEGURANÇA E MANUTENÇÃO</p>
          <h1>Configurações</h1>
          <p>Gerencie a senha da conta e inicie manualmente a cópia criptografada para baixar neste aparelho.</p>
        </div>

        <div className="settings-grid">
          <section className="settings-panel" aria-labelledby="password-title">
            <div className="settings-section-heading">
              <span className="settings-icon"><LockKeyhole size={18} /></span>
              <div>
                <p className="auth-eyebrow">CONTA PRIVADA</p>
                <h2 id="password-title">Alterar senha</h2>
              </div>
            </div>
            <p className="auth-copy">Confirme sua senha atual e escolha uma nova. O e-mail da conta não será alterado.</p>
            <form className="auth-form" onSubmit={submitPassword}>
              <label htmlFor="current-password">Senha atual</label>
              <input
                id="current-password"
                name="current-password"
                type="password"
                autoComplete="current-password"
                maxLength={1024}
                required
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                disabled={loading}
              />
              <label htmlFor="new-password">Nova senha</label>
              <input
                id="new-password"
                name="new-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={1024}
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                disabled={loading}
                aria-describedby="password-guidance"
              />
              <label htmlFor="confirm-password">Confirme a nova senha</label>
              <input
                id="confirm-password"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={1024}
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={loading}
              />
              <p id="password-guidance" className="auth-footnote">Use de 12 a 1024 caracteres. A senha é armazenada somente como hash seguro PBKDF2.</p>
              {error && <p className="auth-error" role="alert">{error}</p>}
              {success && <p className="auth-success" role="status"><CheckCircle2 size={16} /> {success}</p>}
              <button className="auth-submit" type="submit" disabled={loading || !currentPassword || !newPassword || !confirmPassword}>
                {loading ? <><LoaderCircle className="spin" size={17} /> Salvando…</> : <><LockKeyhole size={16} /> Alterar senha</>}
              </button>
            </form>
            <p className="auth-footnote">A troca requer PostgreSQL configurado e a migração manual da tabela de credenciais. Não encerra sessões abertas remotamente; elas expiram após 30 dias sem atividade.</p>
          </section>

          <section className="settings-panel backup-panel" aria-labelledby="backups-title">
            <div className="settings-section-heading">
              <span className="settings-icon"><Archive size={18} /></span>
              <div>
                <p className="auth-eyebrow">ARQUIVOS CRIPTOGRAFADOS</p>
                <h2 id="backups-title">Backup local e restauração</h2>
              </div>
              <button className="backup-refresh" type="button" onClick={() => void loadBackups()} disabled={backupLoading} aria-label="Verificar disponibilidade de backup">
                {backupLoading ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={16} />}
              </button>
            </div>
            <p className="auth-copy">O backup só começa quando você toca no botão. O dump passa diretamente de pg_dump para age e é enviado ao navegador sem arquivo temporário ou retenção no servidor.</p>

            {backupLoading && !backupStatus ? (
              <div className="backup-loading"><LoaderCircle className="spin" size={18} /> Verificando a configuração…</div>
            ) : (
              <>
                {backupStatus && !backupStatus.download_available && (
                  <div className="backup-status" role="status"><ShieldAlert size={18} /><p>{backupStatus.message}</p></div>
                )}
                {backupStatus?.download_available && (
                  <div className="backup-status backup-ready" role="status"><CheckCircle2 size={18} /><p>{backupStatus.message}</p></div>
                )}
                {backupStatus?.download_available && (
                  <a className="backup-download-button" href="/v1/admin/backups/download" download>
                    <Download size={17} /> Baixar backup criptografado
                  </a>
                )}
                {backupError && <p className="auth-error" role="alert">{backupError}</p>}
              </>
            )}
            <div className="backup-warning">
              <ShieldAlert size={18} />
              <div>
                <p>Apenas a chave pública age fica na configuração do backend aprovado. Guarde a chave privada sob seu controle, separada do arquivo baixado; sem ela, não será possível abrir o backup. Nenhum host foi escolhido e não há agendamento.</p>
                <p>{backupStatus?.restore_message || 'A restauração fica bloqueada até existir um fluxo validado para enviar o arquivo local e baixar/guardar localmente a cópia pré-restauração.'}</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
