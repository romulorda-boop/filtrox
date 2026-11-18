# TODO — FILTROX

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
