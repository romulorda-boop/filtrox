# FILTROX Web

Cliente Next.js App Router, TypeScript, Tailwind CSS 4 e Zustand, otimizado para grade mobile. Next.js 16 requer Node.js 20.9 ou superior, conforme a [documentação oficial](https://nextjs.org/docs/app/getting-started/installation).

## Acesso privado

Todas as páginas do site, exceto `/login` e os arquivos estáticos necessários para exibir a marca, são protegidas pelo proxy server-side do Next.js. As APIs FastAPI também exigem a sessão assinada; isso inclui `/healthz`, busca, histórico e favoritos. A sessão é um cookie `HttpOnly`, `SameSite=Strict` e `Secure` em produção; cada acesso autenticado a uma página ou API renova o prazo, que vence após 30 dias sem atividade. O e-mail único e o hash PBKDF2 da senha são definidos apenas no servidor. Não existe rota de cadastro/signup.

O login privado e a declaração visual 18+ são etapas distintas. A declaração 18+ é apenas declaratória: não verifica nem comprova idade e não substitui autenticação ou controles legais.

## Configuração e execução local

1. Copie `web/.env.example` para `web/.env.local` e configure `FILTROX_API_ORIGIN` e `FILTROX_SESSION_SECRET` no processo server-side do Next.js.
2. Copie `backend/.env.example` para `backend/.env.local`; configure no backend o mesmo segredo de sessão, o e-mail único, o hash de senha e os demais valores estritamente necessários.
3. Gere o hash com `python backend/scripts/hash_password.py`. Digite a senha no prompt; não a grave em arquivo, comando, repositório ou variável `NEXT_PUBLIC_*`.
4. Em desenvolvimento HTTP local, `FILTROX_COOKIE_SECURE=false`; em produção, use HTTPS e `FILTROX_COOKIE_SECURE=true`.
5. Inicie o backend e depois o Next.js:

```bash
PYTHONPATH=backend /tmp/filtrox-venv/bin/uvicorn app.main:app --app-dir backend --env-file backend/.env.local --reload --port 8000
cd web && npm run dev
```

Credenciais ou segredo ausentes, inválidos ou mal configurados fazem o login falhar fechado. A URL da API e os segredos são lidos pelo servidor; o navegador acessa os caminhos same-origin `/auth/*` e `/v1/*`.

## Validação local

```bash
PYTHONPATH=backend /tmp/filtrox-venv/bin/python -m unittest discover -s backend/tests -v
/tmp/filtrox-venv/bin/python -m compileall -q backend/app backend/tests
cd web && npm run lint && npm run build && npm audit --audit-level=high
```

## Contrato da API

`POST /auth/login` verifica apenas a conta privada configurada no servidor usando e-mail e senha. O cookie assinado é renovado nas páginas e APIs autenticadas e vence após 30 dias sem atividade. `POST /auth/logout` remove o cookie deste dispositivo. Não há signup público nem encerramento remoto global. Todas as demais APIs exigem sessão válida e ignoram qualquer declaração 18+ enviada pelo cliente.

`POST /v1/catalog/search` recebe query, termos obrigatórios/opcionais/proibidos, frases exatas, equivalências manuais, tags, idioma, país, `hide_watched`, ordenação primária/secundária e paginação limitada a 30 itens. As facetas dinâmicas e as fontes de cada tag vêm da API.

`GET /v1/me/history` e `GET /v1/me/favorites` retornam registros associados à identidade do proprietário determinada no servidor. `POST /v1/me/history` registra reprodução e `POST /v1/me/favorites` atualiza favoritos; `DELETE /v1/me/history` apaga o histórico.

O cliente não usa `localStorage`, token em JavaScript, catálogo de demonstração ou cadastro público. Nenhum conteúdo externo é carregado antes da ação explícita do usuário.
