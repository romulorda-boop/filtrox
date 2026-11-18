# FILTROX — checklist atualizado de conformidade e publicação

**Estado: checklist aprovado para preparação/abertura do PR; NÃO APROVADO PARA MERGE OU PUBLICAÇÃO.** A branch `colab1` parte do commit base atual de `main` (`a583e30`). Esta aprovação não autoriza merge, deploy, criação de recursos pagos nem acesso aos CSVs reais; nenhum CSV real foi baixado, aberto ou analisado.

## Fontes e dados

| Fonte | Estado | Controles atuais |
|---|---|---|
| `xvideos_up.csv` | Ativa no código | Host e caminho Blob exatos; SAS de leitura só no backend; limite de bytes/registros; dados removidos filtrados antes de busca e facetas. Nenhuma requisição foi feita. |
| `xvideos_remove.csv` | Ativa no código | Lida junto do catálogo e aplicada antes de exibir resultados. Nenhuma requisição foi feita. |
| `pornhub_up.csv` | Planejada, desativada | Referência do SAS de leitura fica em `backend/.env.local`, ignorada pelo Git. `FILTROX_ENABLE_PORNHUB=false`; se configurada como `true`, a API falha fechada antes de Redis, SAS ou rede. Não há parser ativo nem acesso ao arquivo. |

A consulta anterior às páginas oficiais do [Pornhub Webmasters](https://www.pornhub.com/webmasters) e da [documentação oficial de Webmasters](https://help.pornhub.com/hc/en-us/sections/4419836305043-Webmasters) indica recursos de parceiro/feed, mas não valida o formato exato do `pornhub_up.csv` fornecido nem resolve como aplicar sua lista de removidos. O arquivo e o SAS não foram testados. Não use scraping ou fontes não documentadas.

## Implementado e testado localmente

- [x] Frontend Next.js App Router/TypeScript/Tailwind/Zustand, responsivo para Android, identidade visual preta/vermelha e marca FILTROX.
- [x] Busca estrita por palavras completas e AND, frases exatas ordenadas, inclusões/exclusões, equivalências manuais, filtros dinâmicos, dois critérios de ordenação e paginação de até 30 resultados.
- [x] Carregador Xvideos com limites de tamanho/linhas, streaming, deduplicação e filtro de removidos antes de facetas; testes só com fixtures sintéticas.
- [x] Play abre somente URL HTTPS validada do Xvideos após toque explícito. Nenhuma mídia é pré-carregada. Player Pornhub ainda não foi integrado.
- [x] API privada preparada com validação OIDC (issuer, audience e JWKS), allowlist de conta e claim assinada de idade com timestamp de verificação e prazo máximo. Sem configuração, a autenticação falha fechada; não há checkbox declaratório.
- [x] Histórico e favoritos preparados para PostgreSQL server-side, separados por identidade pseudonimizada; limpeza de histórico implementada; o cliente não persiste esses dados em `localStorage`.
- [x] Cache Redis para produção, memória somente em desenvolvimento, TLS obrigatório para PostgreSQL remoto e CORS sem wildcard.
- [x] O teste verifica que tentar ativar Pornhub ainda sem revisão falha antes de qualquer I/O. Nenhum serviço, login, Blob, feed ou banco real foi chamado.

## Decisões e validações ainda necessárias

- [ ] Escolher o provedor OIDC e a única conta autorizada; configurar issuer, audience, JWKS e subject apenas no servidor.
- [ ] Escolher provedor confiável de verificação etária e aprovar os claims assinados do indicador 18+, timestamp e revalidação. Datas digitadas e checkboxes não são prova.
- [ ] Validar documentação oficial, esquema, encoding, atualização e lista de remoções do `pornhub_up.csv`; só depois implementar o parser em modo de homologação, sem habilitar produção até nova aprovação.
- [ ] Confirmar hospedagem realmente privada. O Azure Static Web Apps e o workflow atuais continuam públicos e apontam para a versão antiga.
- [ ] Definir jurisdição, aviso de conteúdo adulto, retenção e exclusão. A exclusão de histórico está disponível; prazo de retenção automática ainda não foi definido.
- [ ] Aprovar que Play abra `xvideos.com`: o fornecedor poderá receber o IP do usuário; o link usa `noopener,noreferrer`. Não há proxy de mídia.
- [ ] Decidir se serão necessárias equivalências automáticas. Por enquanto, as equivalências são manuais para não buscar dados de outras fontes.

## Bloqueios antes de qualquer publicação

- [ ] Implementar e testar login/logout real, expiração/revogação de sessão, allowlist e integração com os provedores escolhidos.
- [ ] Validar claims e timestamp com o provedor de idade; simular ausência, expiração, data futura e adulteração.
- [ ] Configurar PostgreSQL/Redis, TLS com validação de CA/host, migrações, isolamento, backups diários com sete cópias e restauração testada. Nenhum banco foi criado.
- [ ] Definir CSP, CORS privado, rate limit, política de sessão/CSRF e armazenamento de segredos na hospedagem final.
- [ ] Após autorização, homologar os dois CSVs Xvideos no ambiente privado para esquema, encoding, remoções, volume e atualização; isso não foi feito nesta etapa.
- [ ] Aprovar separadamente qualquer leitura/homologação do CSV Pornhub; validar remoções, formato e privacidade antes de alterar a flag.
- [ ] Testar Android, acessibilidade, concorrência, resiliência e carga com ambiente e dados autorizados.
- [ ] Revisar custos e segredos antes de provisionar Azure; obter autorização explícita separada antes de merge, publicação ou recursos pagos. A aprovação atual cobre somente a abertura do PR para revisão.

## Referências técnicas

A [documentação oficial do Next.js](https://nextjs.org/docs/app/getting-started/installation) lista Node.js 20.9+ como requisito. O guia oficial do [Tailwind CSS v4 para Next.js](https://tailwindcss.com/docs/guides/nextjs) orienta o plugin PostCSS usado. A [referência oficial do asyncpg](https://magicstack.github.io/asyncpg/current/api/index.html) distingue `ssl="require"` (TLS sem validar certificado) de `verify-ca` e `verify-full`; o protótipo exige TLS remoto, mas a verificação de CA/host depende da infraestrutura escolhida.
