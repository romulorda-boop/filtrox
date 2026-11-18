# FILTROX — checklist atualizado de conformidade e publicação

**Estado: revisão de autenticação e sessão destinada à atualização do PR #5; nenhuma autorização para merge, deploy em produção ou provisionamento.** O workflow Azure aceita eventos `pull_request` que podem gerar preview. Por isso, o push desta revisão requer pausar o workflow somente durante o envio e reativá-lo depois. O histórico do PR registra uploads bem-sucedidos em revisões anteriores e execuções posteriores do job de fechamento; esta revisão não autoriza novo preview. Nenhum CSV real foi baixado, aberto ou analisado.

## Fontes e dados

| Fonte | Estado | Controles atuais |
|---|---|---|
| `xvideos_up.csv` | Ativa no código | Host e caminho Blob exatos; SAS de leitura apenas no backend; limite de bytes/registros; itens removidos filtrados antes de busca e facetas. Nenhuma requisição foi feita. |
| `xvideos_remove.csv` | Ativa no código | Lida junto do catálogo e aplicada antes de exibir resultados. Nenhuma requisição foi feita. |
| `pornhub_up.csv` | Planejada, desativada | `FILTROX_ENABLE_PORNHUB=false`; tentar habilitar sem revisão falha antes de I/O. Não há parser ativo nem acesso ao arquivo. |

A documentação oficial do [Pornhub Webmasters](https://www.pornhub.com/webmasters) e da [seção oficial de Webmasters](https://help.pornhub.com/hc/en-us/sections/4419836305043-Webmasters) não valida o formato exato do CSV planejado nem resolve a política de remoções. Não usar scraping ou fontes não documentadas.

## Implementado e testado localmente

- [x] Busca estrita, filtros dinâmicos, equivalências manuais, ordenação dupla e paginação limitada a 30 itens.
- [x] Login por uma única conta individual, com e-mail e hash PBKDF2 definidos apenas no servidor; não existe signup/cadastro público.
- [x] Cookie de sessão assinado, `HttpOnly`, `SameSite=Strict`, renovado em páginas e APIs autenticadas e expirado após 30 dias sem atividade; `Secure` obrigatório em produção.
- [x] Proxy server-side do Next.js exige sessão válida antes de entregar páginas privadas; o FastAPI exige a mesma sessão em todas as APIs, incluindo `/healthz`, busca, histórico e favoritos.
- [x] Credenciais/segredo ausentes ou inválidos causam falha fechada. O hash pode ser gerado localmente por `python backend/scripts/hash_password.py`; senha em texto puro não é armazenada pelo código.
- [x] Declaração 18+ aparece depois do login, como camada declaratória independente. Não verifica nem comprova idade, não compõe a autenticação e não é prova de conformidade legal.
- [x] Carregador Xvideos com limites, streaming, deduplicação e remoções antes das facetas; testes somente com dados sintéticos.
- [x] Smoke test integrado local com credenciais sintéticas confirmou redirect para login, acesso após autenticação, APIs sem cookie bloqueadas, cookie protegido, logout e falha fechada sem catálogo configurado.
- [x] 43 testes unitários sintéticos, compilação Python, lint e build Next.js passaram; os testes usam somente dados sintéticos.
- [x] Nenhum login real, Blob, feed, banco ou serviço externo foi chamado nesta validação; nenhum CSV real foi lido.

## Configuração necessária antes de qualquer teste privado ou publicação

- [ ] Definir no secret store do servidor o único `FILTROX_LOGIN_EMAIL`, `FILTROX_LOGIN_PASSWORD_HASH` e `FILTROX_SESSION_SECRET` aleatório de pelo menos 32 bytes. Nunca colocar credenciais em código, commit, bundle ou variáveis `NEXT_PUBLIC_*`.
- [ ] Configurar o mesmo segredo de sessão apenas no ambiente server-side do Next.js e do FastAPI; definir `FILTROX_API_ORIGIN` privado e as origens CORS exatas.
- [ ] Em produção, publicar somente por HTTPS e manter `FILTROX_COOKIE_SECURE=true`; a sessão expira após 30 dias sem atividade e renova ao acessar páginas ou APIs autenticadas. Logout limpa somente o cookie deste dispositivo; por ser sessão stateless, não há encerramento remoto global e a rotação do segredo revoga todas as sessões já emitidas.
- [ ] Definir rate limiting para tentativas de login, verificação de origem/CSRF, CSP, CORS privado, política de retenção e processo de troca de senha antes de expor o serviço.
- [ ] Confirmar hospedagem realmente privada. A hospedagem Azure Static Web Apps atual permanece pública e aponta para a versão antiga.
- [ ] Definir jurisdição e aviso de conteúdo adulto; a declaração 18+ não verifica idade nem prova legalidade.

## Bloqueios antes de qualquer publicação

- [ ] Configurar e testar as credenciais reais somente no servidor privado autorizado; verificar login, senha incorreta, logout, expiração, rotação/revogação e ausência de signup público.
- [ ] Revisar rate limiting, CSRF/origem, CSP, CORS, TLS, armazenamento de segredos e proteção contra tentativas automatizadas.
- [ ] Configurar PostgreSQL/Redis, TLS com validação de CA/host, migrações, isolamento, backups diários com sete cópias e restauração testada. Nenhum banco foi criado.
- [ ] Após autorização separada, homologar os dois CSVs Xvideos no ambiente privado para esquema, encoding, remoções, volume e atualização; isso não foi feito nesta etapa.
- [ ] Aprovar separadamente qualquer leitura/homologação do CSV Pornhub; validar remoções, formato e privacidade antes de alterar a flag.
- [ ] Testar Android, acessibilidade, concorrência, resiliência e carga com ambiente e dados autorizados.
- [ ] Revisar custos e segredos antes de provisionar Azure. A autorização desta tarefa cobre a atualização do PR #5 com pausa temporária do workflow durante o push; não autoriza merge, deploy em produção, leitura de CSVs reais ou recursos pagos.

## Referências técnicas

A [documentação oficial do Next.js](https://nextjs.org/docs/app/getting-started/installation) lista Node.js 20.9+ como requisito. O guia oficial do [Tailwind CSS v4 para Next.js](https://tailwindcss.com/docs/guides/nextjs) orienta o plugin PostCSS usado. A [referência oficial do asyncpg](https://magicstack.github.io/asyncpg/current/api/index.html) distingue `ssl="require"` (TLS sem validar certificado) de `verify-ca` e `verify-full`; o protótipo exige TLS remoto, mas a verificação de CA/host depende da infraestrutura escolhida.
