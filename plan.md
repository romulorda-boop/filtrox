# Plano — tags oficiais no menu lateral da homepage FiltroX

## Escopo

Integrar na homepage `/` a lista oficial de tags, calculada em tempo de execução exclusivamente da coluna `tags` do CSV oficial de vídeos e após aplicar a lista oficial de remoções. Não publicar o arquivo de exportação gerado anteriormente como recurso estático.

Ao expandir “Todas as tags”, a homepage busca os dois CSVs configurados com `cache: no-store`, deduplica vídeos e tags, calcula o número real de vídeos por tag, oferece um campo de filtro e renderiza os resultados em lotes para reduzir trabalho no DOM. Selecionar uma tag abre `/catalog/?tag=...`; o catálogo já lê os CSVs oficiais e filtra por correspondência exata. O endpoint atual `/api/catalog` não encontra o CSV-base no checkout local; por isso, a navegação da tag não dependerá dele.

## Arquivos e responsabilidades

- `public/index.html`: incluir configuração dos CSVs e controles acessíveis da lista expansível na sidebar.
- `public/home.js`: ler/parsing dos CSVs atuais, excluir remoções, deduplicar e contar tags, filtrar a lista localmente em lotes e navegar ao catálogo com a tag selecionada.
- `public/home.css`: estilos da lista, estados interativos e layout desktop/mobile sem overflow horizontal.
- `public/app.js`: inicializar a rota do catálogo com busca e filtro exato recebidos em `?tag=...`.
- `public/data-config.js`: reutilizar a configuração existente das URLs/índices oficiais; não copiar ou exibir valores SAS em novos arquivos ou logs.
- `TODO.md`: registrar implementação e evidências após validar.

## Restrições

Não criar tags, categorias ou métricas; não usar elenco como fonte de tags; não salvar busca em armazenamento local; não depender do endpoint `/api/catalog` para filtrar uma tag; preservar busca e rotas existentes. A lista reflete a configuração atual dos dois CSVs e usa política de cache sem armazenamento antigo.


## Extensão de infraestrutura — inicialização de importação SWA

- Implementar a rota HTTP `POST /api/catalog/import/start` como uma Azure Function do diretório `api/` já publicado pelo workflow SWA, sem criar backend separado nem alterar Next.js/FastAPI.
- Exigir token administrativo server-side `CATALOG_IMPORT_TOKEN`, comparado em tempo constante; nunca aceitar token, URL SAS ou credenciais no corpo do pedido, nunca logar esses valores e nunca usar `ageConfirmed` como autorização administrativa.
- Validar uma lista fechada de fontes (`xvideos`, `pornhub`) e persistir um manifesto inicial de controle em `imports/<runId>/state.json` no container configurado por `CATALOG_CONTROL_CONTAINER_SAS_URL`.
- Usar SAS de container HTTPS restrito a criação/escrita (`sr=c`, permissões `c` e `w`), `If-None-Match: *`, timeout de rede inferior ao teto de 45 segundos do SWA, sem devolver nem registrar o SAS.
- O manifesto inicial registra esquema, runId, estado e contadores/cursor vazios por fonte, além do prefixo de staging versionado; não inclui URLs de origem, SAS, conteúdo dos CSVs ou dados de vídeos.
- Se os App Settings de token ou Blob não estiverem definidos, responder de forma segura e não simular uma gravação real; validar o fluxo por testes unitários com fetch Azure mockado. Não publicar, fazer merge ou gravar no Blob real nesta etapa.
