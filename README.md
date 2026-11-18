# FILTROX — protótipo local, ainda não publicado

A branch `colab1` contém a nova aplicação local do FILTROX: frontend Next.js e backend FastAPI. O PR é para revisão; não há autorização para merge, deploy ou criação de serviço Azure. Os CSVs reais não foram baixados, abertos ou analisados. A hospedagem pública atual continua sendo a versão antiga e não foi alterada.

## Fontes planejadas

**Xvideos — ativo no código.** O backend lê somente `xvideos_up.csv` e `xvideos_remove.csv` do Azure Blob, por URLs server-side de leitura e caminhos exatos. A lista de removidos é aplicada antes de busca e facetas; o SAS não chega ao navegador.

**Pornhub — planejado, ainda desligado.** O SAS de leitura de `pornhub_up.csv` foi guardado em `backend/.env.local`, ignorado pelo Git. `FILTROX_ENABLE_PORNHUB=false` é o default; se alguém tentar ativá-lo, o backend falha fechado antes do Redis, SAS ou rede. Ainda falta confirmar o formato oficial do arquivo, a política de remoções e os controles de privacidade. Nenhum parser foi habilitado e nenhum arquivo Pornhub foi acessado. A documentação oficial do [portal Webmasters](https://www.pornhub.com/webmasters) e da [seção oficial de Webmasters](https://help.pornhub.com/hc/en-us/sections/4419836305043-Webmasters) não substitui a validação do formato exato do CSV.

Não há scraping nem contorno de bloqueios. O botão Play abre somente uma URL HTTPS validada do Xvideos, depois de ação explícita do usuário; não há player incorporado Pornhub ativo.

## Implementação e testes locais

A aplicação inclui busca estrita por palavras completas, frases ordenadas, filtros, equivalências manuais, ordenação primária/secundária, paginação limitada a 30 itens e rotas server-side de histórico/favoritos isoladas por conta. O histórico pode ser apagado; o cliente não grava esses registros em `localStorage`.

O carregador Xvideos tem limites de bytes/registros, streaming, remoção antes das facetas e cache. PostgreSQL remoto exige TLS; confirmação do certificado e a infraestrutura ainda precisam ser definidas. O backend exige token OIDC assinado, conta em allowlist e claim de idade acompanhada de timestamp assinado dentro do prazo. Sem provedor e claims aprovados, a autenticação falha fechada e a interface permanece desabilitada (`ready=false`).

Os testes usam somente dados sintéticos, sem chamadas a Azure, Xvideos, Pornhub, provedores de login ou banco real:

```bash
PYTHONPATH=backend /tmp/filtrox-venv/bin/python -m unittest discover -s backend/tests -v
/tmp/filtrox-venv/bin/python -m compileall -q backend/app backend/tests
cd web && npm run lint && npm run build && npm audit --audit-level=high
```

## Executar localmente

Use `backend/.env.example` como referência. Os SAS ficam apenas no backend; nunca os copie para o frontend. A configuração local não é uma autorização para baixar os CSVs: Pornhub permanece desligado e o login/age gate ainda não têm provedores selecionados.

```bash
PYTHONPATH=backend /tmp/filtrox-venv/bin/uvicorn app.main:app --app-dir backend --env-file backend/.env.local --reload --port 8000
```

Para inspeção visual em outra sessão:

```bash
cd web
npm install
npm run dev
```

## Antes de qualquer publicação

O [checklist atualizado](COMPLIANCE_CHECKLIST.md) lista os bloqueios e escolhas ainda pendentes. A aprovação recebida autoriza somente a preparação e abertura deste PR para revisão; não autoriza merge, publicação, leitura de CSV real ou recursos pagos. A hospedagem Azure Static Web Apps e o workflow atuais continuam públicos e apontam para a versão antiga. Não faça merge nem publique até concluir os bloqueios e receber autorização explícita separada; não provisionar recursos que possam gerar custo.
