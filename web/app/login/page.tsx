'use client';

import { FormEvent, useState } from 'react';

function safeNextPath(): string {
  const candidate = new URLSearchParams(window.location.search).get('next') ?? '/';
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate === '/login') return '/';
  return candidate;
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        setError(response.status === 401
          ? 'E-mail ou senha incorretos.'
          : 'O login privado não está configurado ou está temporariamente indisponível.');
        return;
      }
      window.location.replace(safeNextPath());
    } catch {
      setError('Não foi possível conectar ao serviço de login. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="login-title">
        <a className="auth-brand" href="/login" aria-label="FILTROX">
          <img src="/filtrox-mark.svg" alt="FILTROX" width="190" height="40" />
        </a>
        <p className="auth-eyebrow">ACESSO PRIVADO</p>
        <h1 id="login-title">Entre na sua conta</h1>
        <p className="auth-copy">O FILTROX é de uso pessoal. Use as credenciais configuradas no servidor.</p>
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            maxLength={254}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={loading}
          />
          <label htmlFor="password">Senha</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={1024}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={loading}
          />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" type="submit" disabled={loading || !email || !password}>
            {loading ? 'Verificando…' : 'Entrar'}
          </button>
        </form>
        <p className="auth-footnote">Cadastro público indisponível. O acesso depende de uma conta configurada pelo proprietário no servidor.</p>
      </section>
    </main>
  );
}
