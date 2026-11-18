# FILTROX Web

Cliente Next.js App Router, TypeScript, Tailwind CSS 4 e Zustand, otimizado para grade mobile. Next.js 16 requer Node.js 20.9 ou superior, conforme a [documentação oficial](https://nextjs.org/docs/app/getting-started/installation).

## Execução local

```bash
cp .env.example .env.local
# NEXT_PUBLIC_API_BASE_URL é opcional e não é um segredo.
npm install
npm run dev
```

O cliente está deliberadamente fechado (`ready = false`): não existe integração OIDC, sessão, nem prova confiável 18+. Nenhum flag público pode simular autenticação; adicionar somente a URL base da API não habilita chamadas de catálogo. Não coloque token, senha ou SAS em variáveis `NEXT_PUBLIC_*`.

Validação local:

```bash
npm run lint
npm run build
npm audit --audit-level=high
```

## Contrato previsto da API

`POST /v1/catalog/search` recebe query, termos obrigatórios/opcionais/proibidos, frases exatas, equivalências manuais, tags, idioma, país, `hide_watched`, ordenação primária/secundária e paginação limitada a 30 itens. As facetas dinâmicas e as fontes de cada tag vêm da API.

`GET /v1/me/history` e `GET /v1/me/favorites` retornam registros associados à identidade validada no servidor. `POST /v1/me/history` recebe `{ "video_id": "…", "url": "…" }`; `POST /v1/me/favorites` recebe `{ "video_id": "…", "url": "…", "enabled": true }`.

O cliente não usa `localStorage`, cookies de sessão, catálogo de demonstração ou fontes de vídeo próprias. O `embed_url` oficial do Pornhub só pode ser carregado após Play; se não existir embed permitido, Play abre apenas uma URL HTTPS validada do fornecedor. Nenhum conteúdo é carregado antes da ação explícita do usuário.
