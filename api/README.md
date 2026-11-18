# Azure Static Web Apps API

A API desta pasta é publicada pelo workflow do Azure Static Web Apps. O endpoint novo `POST /api/catalog/import/start` inicializa um trabalho de importação e grava o estado inicial no Azure Blob Storage. Ele não baixa nem processa os CSVs; as fases de leitura, transformação e publicação continuam fora deste endpoint.

## App Settings necessários

Configure no ambiente Azure que hospedará a API, sem adicionar valores ao repositório ou ao frontend:

- `CATALOG_IMPORT_TOKEN`: segredo aleatório de pelo menos 32 bytes, enviado somente pelo cliente administrativo em `Authorization: Bearer <token>`.
- `CATALOG_CONTROL_CONTAINER_SAS_URL`: URL HTTPS de um container dedicado de controle, no endpoint Azure Blob, com SAS de container (`sr=c`) e permissões exatamente `sp=cw` (criar e escrever, sem leitura, listagem ou outras permissões). A assinatura precisa estar válida. Use um container dedicado para o estado/catálogo, não o container das fontes.

Se qualquer App Setting estiver ausente, inválido ou sem permissão, a função falha fechada e não cria um registro. A URL SAS e a resposta de erro do Azure não são devolvidas nem registradas em logs.

## Chamada

```http
POST /api/catalog/import/start
Authorization: Bearer <CATALOG_IMPORT_TOKEN>
Content-Type: application/json
```

Corpo permitido:

```json
{"sources":["xvideos","pornhub"]}
```

`sources` deve conter um ou ambos os valores exatos, sem duplicatas. O endpoint não aceita URLs, SAS, nomes arbitrários nem outros campos. Em sucesso, responde HTTP 201 com `runId`, `status`, timestamp, fontes e o caminho lógico do controle. O blob criado é `imports/<runId>/state.json`; ele contém o estado `initialized`, cursores e contadores zerados por fonte e o prefixo de staging `versions/<runId>/`. Não contém URLs dos CSVs, SAS ou registros de vídeo. A criação usa `If-None-Match: *`, então uma colisão não sobrescreve um estado existente.

Códigos esperados: 201 inicializado, 400 corpo/fontes inválidos, 401 token inválido, 405 método incorreto e 503 configuração/armazenamento indisponível. A operação tem timeout de rede curto para permanecer abaixo do limite de duração de API do SWA. Não há aqui endpoints de progresso, etapa, cancelamento ou finalização; nem gravação foi feita em um Blob real nesta validação local.

## Testes

Execute `npm --prefix api test`. Os testes mockam `fetch` e usam somente SAS sintético; não chamam o Azure real.
