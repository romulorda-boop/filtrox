# FILTROX — Cinema after dark

Site estático FILTROX com busca local no catálogo oficial, lista dinâmica de tags e uma busca federada PeerTube preservada em rota própria.

## Páginas

| Rota | Conteúdo |
| --- | --- |
| `/` | Gate declaratório 18+, busca no catálogo oficial e lista de tags via API same-origin `/api/catalog`. |
| `/catalog/` | Gate declaratório 18+ e catálogo editorial via API same-origin `/api/catalog`. |
| `/rota-search/` | Busca federada SepiaSearch, com confirmação declaratória de 18 anos e autorização explícita antes de enviar cada termo. |

## Executar localmente

Requisito: Node.js 18 ou superior. O servidor local inclui a rota same-origin `/api/catalog` e não exige dependências locais.

```bash
npm start
```

Abra `http://localhost:3000`. Para usar outra porta, defina `PORT` antes de iniciar o servidor. Configure no ambiente do servidor `CATALOG_CSV_URL` e `CATALOG_REMOVAL_CSV_URL` com os SAS restritos a leitura. Não coloque esses valores em `public/`, `.env` versionado, HTML, JavaScript, assets ou logs.

## Estrutura principal

- `public/index.html` — gate 18+, busca no catálogo oficial e lista expansível de tags.
- `public/home.js` — consulta a API same-origin, pesquisa, filtros e paginação da homepage.
- `public/data-config.js` — somente delimitadores e índices não sensíveis das colunas dos CSVs oficiais.
- `api/catalog/function.json` e `api/catalog/index.js` — endpoint HTTP `/api/catalog` da Azure Static Web Apps.
- `api/catalog/catalog.js` — validação das origens, leitura e parsing dos CSVs, remoções, busca, tags e paginação.
- `public/catalog/index.html` e `public/app.js` — gate 18+ e catálogo editorial preservado, carregado pela API same-origin.
- `public/rota-search/` — cliente SepiaSearch, age gate, consentimentos, filtros e cartões responsivos.
- `public/staticwebapp.config.json` — cabeçalhos e regras do Azure Static Web Apps.
- `server.js` — servidor estático local com a API do catálogo.
- `TODO.md` — entregas e pendências operacionais.

## Busca principal e CSVs oficiais

As rotas `/` e `/catalog/` só chamam `POST /api/catalog` depois que a pessoa confirma ter 18 anos ou mais. A função obtém os dois SAS exclusivamente de `process.env.CATALOG_CSV_URL` e `process.env.CATALOG_REMOVAL_CSV_URL`; os clientes não enviam nem recebem as URLs. Configure esses valores em Azure Static Web Apps **Settings / Environment variables** (ou armazenamento seguro equivalente) e use variáveis de ambiente locais para testes. Não use variáveis de build do frontend. A função valida que os links sejam somente leitura e apontem aos dois blobs esperados, exige `ageConfirmed: true`, aplica as remoções antes de calcular resultados e tags e devolve páginas de até 48 itens para `/` ou o catálogo completo para `/catalog/`. Sem confirmação, responde HTTP 403. A resposta usa `Cache-Control: no-store`; o catálogo carregado é mantido em memória pela função por até cinco minutos.

`xvideos_up.csv` não tem cabeçalho e usa `;`: URL na coluna 0, título 1, duração 2, tags 5, elenco 6, visualizações 7, categoria 8, qualidade 9, canal 10 e data 12. As tags são separadas por `|` ou `,`. `xvideos_remove.csv` usa `|`; a URL removida fica na coluna 1. Vídeos removidos e URLs duplicadas não entram na busca nem nas contagens de tags. A ordenação por comentários e avaliação fica desabilitada quando essas métricas não existem no CSV.

Use SAS com permissão somente de leitura e escopo restrito aos dois blobs. Mantenha-os apenas nas App Settings do servidor; nunca os registre ou os inclua em arquivos estáticos, builds ou logs. A homepage não carrega miniaturas externas automaticamente.

A rota `/catalog/` preserva o catálogo editorial, mas agora usa a mesma API same-origin. A página `/rota-search/` é independente do catálogo: a consulta vai a `https://sepiasearch.org/api/v1/search/videos` apenas após a confirmação declaratória de 18 anos e a autorização explícita; filtros permanecem locais e o iframe de origem só é criado após clique.

## Segurança e publicação

A confirmação em `/`, `/catalog/` e `/rota-search/` é declaratória, não verifica identidade/idade e não é persistida. O campo `ageConfirmed` impede chamadas acidentais sem o clique, mas pode ser forjado e não é controle de acesso forte. Os SAS não são enviados ao navegador; a proteção real dos dados deve vir das App Settings/Key Vault e das permissões de leitura restritas.

A publicação do site é disparada pelo workflow **Azure Static Web Apps CI/CD** em pushes para `main`; portanto, valide a branch e aprove as verificações de conformidade antes de fazer merge ou publicar.
