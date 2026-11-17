# TODO — FILTROX

## Entregas concluídas

- [x] **Catálogo editorial responsivo e marca original**
  - Manter o catálogo FiltroX com navegação responsiva, busca local, categorias, ordenação, favoritos, detalhes e prévia visual original.
  - Evidência: catálogo preservado em `/catalog/`; marca FiltroX oficial presente em menus e rodapé.

- [x] **CSV do catálogo carregados do Azure e lista de remoções aplicada**
  - Carregar `xvideos_up.csv` e `xvideos_remove.csv` por URLs configuráveis em `public/data-config.js`.
  - Interpretar base sem cabeçalho, separada por `;`, e lista de remoções sem cabeçalho, separada por `|`; usar a URL para cruzar registros, normalizando host e barras finais.
  - Ocultar vídeos presentes na lista de remoções antes da pesquisa, filtros, contagem e paginação do catálogo.
  - Evidência: o carregador atual faz ambas as leituras em paralelo, registra resumo sem imprimir URLs SAS e remove correspondências antes de renderizar.

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

- [x] **Leitura fresca dos CSVs no navegador**
  - Fazer fetch da base e da lista de remoções com `cache: 'no-store'`, para não reutilizar cópias antigas mantidas no cache HTTP do navegador.
  - Evidência: teste de integração simulado confirmou `no-store` nas duas requisições; após acrescentar uma remoção ao fixture e recarregar, o vídeo foi removido da busca. O teste não acessa os blobs reais.

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

- [x] **Homepage `/` — lista completa e categorias populares derivadas das tags oficiais**
  - Gerar categorias exclusivamente a partir da coluna `tags` do CSV oficial e excluir vídeos presentes no CSV oficial de remoções; carregar ambos os CSVs com `cache: no-store`.
  - Disponibilizar lista completa pesquisável e incremental; não inventar tags nem contagens.
  - Selecionar uma tag deve abrir `/catalog/` com filtro exato e preservar a busca atual.
  - Evidência: com os CSVs reais servidos localmente, foram calculadas 5.736 tags oficiais; `amateur` mostrou 6.247 registros e o clique abriu `/catalog/?tag=amateur`. Com API simulada, busca textual retornou dois itens e “Mais assistidos” reordenou por visualizações. Preview desktop e viewport móvel de 390 px validados.

## Atualização solicitada — redesenho da homepage

- [ ] **Refazer a página inicial usando o anexo de modelo; ajustar as cores e o logo; fundo preto e cores vermelhas; logo do FILTROX; adicionar categorias pelas tags do CSV; fazer margens e deploy.**
  - Conservar a busca e a lista completa de tags oficiais já existentes; as categorias visíveis na homepage devem ser criadas dinamicamente exclusivamente a partir da coluna `tags` dos CSVs, após aplicar o arquivo oficial de remoções.
  - Aplicar a identidade preta/vermelha e o logo FILTROX, ajustar espaçamentos/margens e manter o layout responsivo para celular e desktop; testar, enviar a branch `Colab3` e promover as alterações para `main` para disparar o deploy automático.
  - Evidência local: redesign implementado e testado com dados reais na prévia. O envio para `main` está pendente porque os SAS de `data-config.js` expiraram e a leitura na origem publicada depende de CORS/SAS válidos.

## Pendências operacionais

- [ ] **Renovar os SAS e confirmar CORS na origem publicada**
  - Os SAS de leitura atualmente configurados expiraram: remoções em `2026-11-17T10:23:54Z` e base em `2026-11-17T10:24:37Z`; gerar links novos e restritos a leitura.
  - Validar no navegador da origem Azure Static Web Apps que os blobs aceitam CORS para `GET` antes de promover a homepage para `main`. Não registrar tokens completos neste arquivo.

## Comandos de verificação

```bash
node --check public/app.js
node --check public/rota-search/app.js
node --check public/rota-search/api.js
node --check public/rota-search/filters.js
node --check server.js
git diff --check
```
