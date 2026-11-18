# TODO — FILTROX

## Detalhes de vídeo e prévias condicionais
- [x] Adicionar ficha acessível e responsiva com título, fonte, duração, tags, idioma/país e, quando existentes, visualizações e data do modelo. Não criar metadados ausentes.
- [x] Preparar prévia somente a partir do campo explícito `preview_url`, com HTTPS, host Xvideos permitido, sem credenciais e apenas porta padrão/443. O player só monta após ação explícita, inicia mutado e sem controles de áudio; não reutiliza URL da página ou miniatura como vídeo.
- [x] Fixtures e testes locais cobrem os metadados existentes e a validação de URLs sem tráfego externo. O parser ativo não emite `preview_url`, `thumbnail_url` ou `image_url`; portanto, a prévia permanece indisponível no catálogo atual.
- [ ] Antes de habilitar uma prévia em instância real, confirmar que a fonte autorizada fornece um campo/URL curta de prévia e autoriza sua reprodução; só então estender o parser e testar com dados sintéticos. Pornhub continua desligado; XNXX requer coleta autorizada.

## Filtros multi-tag e facetas
- [x] Inclusão com AND/OR configurável; AND continua sendo o padrão, e exclusões permanecem como “qualquer tag excluída bloqueia”.
- [x] Agrupar tags de fontes distintas somente quando o texto for idêntico; contar vídeos distintos no conjunto completo de resultados, não ocorrências nem apenas a página visível.
- [x] Manter idiomas como faceta separada; nenhuma tradução ou equivalência é inferida/aplicada automaticamente. A ação “Limpar tudo” reinicia termo, filtros e paginação.
- [x] Cobertura sintética de modos, contagens, agrupamento exato e grafias que diferem por caixa; validação local do backend e do frontend.

## Integração local de infraestrutura — Meilisearch
- [x] **Adicionar Meilisearch ao caminho de busca do backend**
  - Indexar somente IDs e fingerprints HMAC dos tokens gerados a partir de título/tags; nunca enviar URLs, texto integral, credenciais ou dados de conta ao índice.
  - Manter busca estrita, frases, exclusões, equivalências, filtros, facetas, ordenação e paginação no validador Python existente.
  - Aplicar remoções antes da indexação; sincronizar alterações removendo documentos anteriores e indexando apenas o catálogo autorizado atual.
  - Limitar o índice a 10.000 candidatos por consulta; quando o teto puder truncar resultados, executar a busca exata completa localmente.
  - Evidência: testes sintéticos com `httpx.MockTransport`; nenhum Meilisearch real, CSV real, Azure ou serviço externo foi acessado.
- [ ] **Validar operação real e coordenação de índice antes de homologar**
  - Testar o serviço local com catálogo sintético autorizado e validar reconstrução, paginação, erros, latência e recuperação após reinício.
  - O lock de sincronização atual é por processo; antes de usar mais de um worker, adicionar lock distribuído ou estratégia de troca atômica de índices.
  - Não configurar nem publicar em hospedagem pública nesta etapa.

## Persistência PostgreSQL — histórico e favoritos
- [x] Modelos de saída tipados e repositório de histórico/favoritos mantêm a chave do admin em todas as queries; as APIs pessoais usam somente `Principal.actor_id`, nunca um ID de conta do cliente.
- [x] Exportação autenticada do histórico e dos favoritos em CSV e JSON, com leitura integral por `actor_id`, campos permitidos explícitos e defesa contra fórmulas em CSV; a interface oferece os quatro downloads.
- [ ] A exportação depende de PostgreSQL provisionado e migrações aplicadas; o banco ainda não foi provisionado. Validar os downloads somente após infraestrutura aprovada, sem testar conexão real nesta etapa.
- [x] Executor explícito e versionado para `backend/sql/001_init.sql`, com ledger, transação por migração, lock concorrente, idempotência e recusa de schema existente sem baseline versionado. Não roda no startup.
- [x] Testes de armazenamento e rotas pessoais usam pool/conexão simulados e dados sintéticos; confirmado que login continua sem signup e sessão permanece deslizante de 30 dias.
- [x] Substituir retenção no servidor por backup manual local: o admin autenticado aciona `GET /v1/admin/backups/download`; `pg_dump` passa diretamente por `age` em pipes e o navegador recebe somente o arquivo criptografado. Não há staging em claro, arquivo de backup no host, diretório dedicado, retenção, cron, scheduler ou cópia automática.
- [x] Exigir `FILTROX_BACKUP_AGE_RECIPIENT` (somente chave pública) e manter a identidade privada sob controle local do proprietário; credencial PostgreSQL fica em passfile anônimo em memória, sem `PGPASSWORD`; `age`/`pg_dump` somente em caminhos de sistema confiáveis root-owned. Testes sintéticos com processos simulados confirmam o fluxo e a falha fechada.
- [x] Manter restauração explicitamente bloqueada: ainda não há fluxo compatível para receber backup local, usar chave local e entregar/salvar um backup criptografado pré-restauração no destino local antes de qualquer alteração. Nenhuma flag pode reativá-la.
- [ ] Nenhuma hospedagem foi escolhida. Antes de usar o download real, aprovar/provisionar infraestrutura privada, configurar `DATABASE_URL` com `sslmode=verify-full`, instalar `age` e `pg_dump` em `/usr/bin` ou `/bin` com propriedade/permissões seguras, gerar/guardar a identidade privada local e configurar somente o destinatário público no backend. Se o DSN tiver senha, o Linux precisa de `memfd_create` e `/proc/self/fd`. Não criar cópias de backup no servidor nem configurar agendamento. Revisar baseline se houver schema existente e só então aplicar migrações em ambiente aprovado.
- [ ] Antes de permitir restauração, implementar e testar um fluxo de arquivo local com confirmação explícita e cópia pré-restauração criptografada baixada/guardada localmente; sem isso, manter bloqueada.
- Evidência desta etapa: 93 testes Python e compilação Python passaram; 7 testes frontend, typecheck TypeScript e `git diff --check` passaram. Não houve conexão PostgreSQL, migração, execução de binário real de banco/age, build Next.js, scheduler, leitura de `.env.local`/segredos ou acesso aos CSVs reais.

## Entregas concluídas

- [x] **Catálogo editorial responsivo e marca original**
  - Manter o catálogo FiltroX com navegação responsiva, busca local, categorias, ordenação, favoritos, detalhes e prévia visual original.
  - Evidência: catálogo preservado em `/catalog/`; marca FiltroX oficial presente em menus e rodapé.

- [x] **CSV do catálogo carregados do Azure e lista de remoções aplicada**
  - Carregar `xvideos_up.csv` e `xvideos_remove.csv` usando exclusivamente `CATALOG_CSV_URL` e `CATALOG_REMOVAL_CSV_URL` do ambiente do servidor.
  - Interpretar base sem cabeçalho, separada por `;`, e lista de remoções sem cabeçalho, separada por `|`; usar a URL para cruzar registros, normalizando host e barras finais.
  - Ocultar vídeos presentes na lista de remoções antes da pesquisa, filtros, contagem e paginação do catálogo.
  - Evidência: o carregador server-side faz ambas as leituras em paralelo; os clientes não escolhem nem recebem URLs SAS.

- [x] **Busca federada como homepage e identidade do template**
  - Usar `/` como página inicial do portal de busca; conservar `/rota-search/` como alias e preservar o antigo catálogo em `/catalog/`.
  - Reproduzir a estrutura visual do template de referência e substituir as marcas do template pelo SVG oficial FiltroX em favicon, cabeçalho, rodapé e fallback de cartão.
  - Exigir confirmação declaratória de 18 anos e autorização explícita antes de enviar qualquer termo ao SepiaSearch.
  - Evidência: manifesto `public/manus-routes.json` lista as três rotas; telas desktop e mobile foram verificadas sem overflow horizontal.

- [x] **Busca PeerTube, filtros locais e proteção de reprodução**
  - Consultar SepiaSearch somente após submissão autorizada, com `privacyOneOf=1`, `nsfw=true` e paginação.
  - Exibir somente vídeos com `privacy.id === 1` e bit `2` (`EXPLICIT_SEX`) em `nsfwFlags`.
  - Gerar tags dos resultados elegíveis; Incluir aceita ao menos uma tag selecionada e Excluir rejeita qualquer tag selecionada.
  - Manter busca, filtros e resultados na memória da página; mostrar a origem; só criar o iframe do PeerTube após clique, sem autoplay, e manter link para a origem.
  - Evidência: módulos em `public/rota-search/api.js`, `filters.js` e `app.js`; busca não é enviada ao carregar a página e miniaturas têm consentimento separado.

- [x] **Refinamentos de UX, metadados e performance**
  - Formatar duração como `MM:SS` ou `HH:MM:SS`; exibir badge de origem e qualidade quando disponível; usar fallback preto/vermelho com marca FiltroX se a miniatura falhar.
  - Oferecer filtros locais de duração (< 5 min, 5–20 min, > 20 min) e qualidade, busca rápida de tags, contagem, limpeza de filtros, paginação e thumbnails `loading="lazy"`.
  - Evidência: implementado em `public/rota-search/`; filtros refinam os resultados já carregados sem outra chamada à API.

- [x] **Leitura server-side fresca dos CSVs**
  - Fazer fetch da base e da lista de remoções no servidor; evitar chamadas do navegador aos blobs.
  - Evidência: smoke test Chromium confirmou zero chamadas browser→Blob antes e depois do gate; as respostas do API usam `Cache-Control: no-store`.

- [x] **Atualização recente de `main` e publicação**
  - Homepage/template, logos e rota `/catalog/` enviados no commit `0db1c15` (`feat: align FiltroX homepage with template`).
  - Evidência: workflow Azure Static Web Apps CI/CD `44014052448` concluiu com sucesso para esse commit.

## Implementação aprovada — `/catalog/`

- [x] **Ordenação do menu lateral por campos oficiais**
  - Exibir “Mais recentes”, “Mais vistos”, “Mais comentados”, “Melhor avaliação” e “Todas as tags”.
  - Ordenar “Mais recentes” por `uploadedAt` (coluna 12) e “Mais vistos” por `views` (coluna 7).
  - Manter “Mais comentados” e “Melhor avaliação” visíveis, porém desabilitados e identificados como indisponíveis enquanto não houver campos reais para essas métricas no CSV oficial. Não inventar dados.
  - Evidência: testes com CSV simulado confirmaram ordem por visualizações e data; métricas sem campo aparecem desabilitadas.

- [x] **Tags exclusivamente da coluna oficial de tags**
  - Derivar a lista apenas da coluna `tags` (coluna 5) de `xvideos_up.csv`, depois de aplicar a lista oficial de remoções. Não usar elenco, categorias, amostras locais ou termos fixos para gerar tags.
  - Disponibilizar a lista completa em uma seção expansível; cada tag deve corresponder a um valor existente no CSV e, ao ser selecionada, deve reutilizar a busca atual para mostrar vídeos relacionados.
  - Evidência: teste com CSV e remoções simulados confirmou fonte exclusiva da coluna 5, filtro exato por tag e ausência de tags do elenco ou de vídeo removido.

- [x] **Busca existente e layout responsivo preservados**
  - Manter funcionando a busca textual atual do catálogo e os demais controles existentes.
  - Adaptar o novo menu e a lista de tags para desktop e celular, sem sobreposição ou overflow horizontal.
  - Evidência: busca manual por título/elenco seguiu ativa; Playwright confirmou abertura do menu e ausência de overflow horizontal em viewport de 390 px.

- [x] **Homepage `/` — lista oficial de tags no menu lateral**
  - Gerar a lista dinamicamente exclusivamente a partir da coluna `tags` do CSV oficial e excluir vídeos presentes no CSV oficial de remoções, processados pelo servidor.
  - Disponibilizar busca dentro da lista e carregamento incremental; não inventar tags ou contagens.
  - Selecionar uma tag deve abrir `/catalog/` com filtro exato e preservar a busca existente.
  - Evidência atual: gate inicial fica visível, a homepage permanece oculta e não chama o API até a confirmação; após o clique, busca, tags e paginação carregam pela mesma origem. Fixtures também confirmam que uma correspondência na lista de remoções é excluída.

## Pendências operacionais

- [ ] **Configurar e verificar as App Settings do servidor**
  - Criar `CATALOG_CSV_URL` e `CATALOG_REMOVAL_CSV_URL` em Azure Static Web Apps > Settings > Environment variables. As APIs gerenciadas do Static Web Apps não dão suporte a referências do Key Vault. Não exibir os valores ao consultar ou validar a configuração.
  - O código já não aceita URLs no corpo do request; sem as duas variáveis, o API deve falhar com HTTP 503 genérico sem registrar os valores.
- [ ] **Verificar as configurações no Azure após aprovação do checklist**
  - As variáveis de produção não foram consultadas nem alteradas. Confirme `CATALOG_CSV_URL` e `CATALOG_REMOVAL_CSV_URL` no ambiente Production do backend; não as coloque em variáveis de build do frontend. Verifique também o ambiente de preview se for validar PRs.
- [ ] **Validar a origem publicada após uma publicação autorizada**
  - `colab1` agora inclui runtime `node:22`, validação do pacote API no workflow e resposta `405` para `GET /api/catalog`; o fluxo de busca permanece em `POST` com gate 18+.
  - Testes locais sintéticos passaram sem acessar os CSVs reais ou os SAS. Não houve push, merge ou deploy; após aprovação, valide `POST /api/catalog` e a busca, tags, remoções e paginação na origem real. Um `GET` direto deve retornar `405`, não `404`.
- [x] **Preservar o filtro de remoções sem inspecionar o conteúdo dos CSVs**
  - O backend continua cruzando a lista oficial de remoções antes de busca, tags, contagens e paginação. A remoção é coberta por fixture sintética; não analisar nem cruzar os arquivos reais nesta etapa.
- [x] **Gate 18+ antes da busca e do catálogo**
  - `/` e `/catalog/` agora ocultam a interface e não fazem chamadas à API até a confirmação declaratória; `/rota-search/` já tinha gate. A API retorna HTTP 403 sem `ageConfirmed: true`.
  - A confirmação é declaratória, não verifica idade e não é persistida; não é controle de acesso forte. Os SAS agora permanecem somente no servidor.
- [x] **Remover dependência de CORS do Blob nas rotas do catálogo**
  - `/` e `/catalog/` consultam `/api/catalog`; o smoke test confirmou zero chamadas browser→Blob antes e depois do gate.
- [x] **Remover SAS de arquivos públicos**
  - `public/data-config.js` contém apenas delimitadores e índices; os requests do navegador não enviam SAS e as respostas não os devolvem.
  - Evidência: varredura em `public/` encontrou zero padrões SAS/URLs de Blob; diretórios de build/log não existem e não há script de build local. Smoke test confirmou configuração e corpos dos requests sem SAS, nenhuma chamada do navegador ao Blob e resposta sem URL de origem; falha simulada não vazou o marcador SAS nos logs/resposta.

## Comandos de verificação

```bash
node --check public/app.js
node --check public/home.js
node --check api/catalog/catalog.js
node --check api/catalog/index.js
node --check public/rota-search/app.js
node --check public/rota-search/api.js
node --check public/rota-search/filters.js
node --check server.js
git diff --check
```
