# FILTROX — protótipo em revisão, sem publicação em produção

A branch `colab1` contém a aplicação local do FILTROX: frontend Next.js e backend FastAPI. Todas as páginas privadas e APIs exigem login com sessão assinada; não há cadastro público. Esta revisão atualiza o PR #5 para avaliação, sem autorização para merge, deploy em produção ou provisionamento. O push deve ocorrer com o workflow Azure temporariamente pausado para impedir um novo preview e reativado em seguida. O histórico do PR registra uploads Azure bem-sucedidos em revisões anteriores, seguidos por execuções do job de fechamento; esta tarefa não autoriza nova publicação. Os CSVs reais não foram baixados, abertos ou analisados, e a hospedagem de produção continua sendo a versão antiga.

## Fontes planejadas

**Xvideos — ativo no código.** O backend lê somente `xvideos_up.csv` e `xvideos_remove.csv` do Azure Blob, por URLs server-side de leitura e caminhos exatos. A lista de removidos é aplicada antes de busca e facetas; o SAS não chega ao navegador.

**Pornhub — planejado, ainda desligado.** O SAS de leitura de `pornhub_up.csv` foi guardado em `backend/.env.local`, ignorado pelo Git. `FILTROX_ENABLE_PORNHUB=false` é o default; se alguém tentar ativá-lo, o backend falha fechado antes do Redis, SAS ou rede. Ainda falta confirmar o formato oficial do arquivo, a política de remoções e os controles de privacidade. Nenhum parser foi habilitado e nenhum arquivo Pornhub foi acessado. A documentação oficial do [portal Webmasters](https://www.pornhub.com/webmasters) e da [seção oficial de Webmasters](https://help.pornhub.com/hc/en-us/sections/4419836305043-Webmasters) não substitui a validação do formato exato do CSV.

Não há scraping nem contorno de bloqueios. O botão Play abre somente uma URL HTTPS validada do Xvideos, depois de ação explícita do usuário; não há player incorporado Pornhub ativo.

## Implementação e testes locais

A aplicação inclui busca estrita por palavras completas, frases ordenadas, filtros, equivalências manuais, ordenação primária/secundária, paginação limitada a 30 itens e rotas server-side de histórico/favoritos isoladas por conta. O histórico pode ser apagado; o cliente não grava esses registros em `localStorage`.

O carregador Xvideos tem limites de bytes/registros, streaming, remoção antes das facetas e cache. PostgreSQL remoto exige TLS; confirmação do certificado e a infraestrutura ainda precisam ser definidas. O login usa o único e-mail e hash PBKDF2 configurados no ambiente privado do servidor, com sessão assinada por segredo compartilhado apenas entre Next.js e FastAPI; cada acesso autenticado renova a sessão, que expira após 30 dias sem atividade. Credenciais ausentes causam falha fechada. Não existe signup público. A declaração 18+ aparece depois do login como camada declaratória separada e não verifica nem comprova idade.

Os testes usam somente dados sintéticos, sem chamadas a Azure, Xvideos, Pornhub, provedores de login ou banco real:

```bash
PYTHONPATH=backend /tmp/filtrox-venv/bin/python -m unittest discover -s backend/tests -v
/tmp/filtrox-venv/bin/python -m compileall -q backend/app backend/tests
cd web && npm run lint && npm run build && npm audit --audit-level=high
```

## Executar localmente

Use `backend/.env.example` e `web/.env.example` como referências. Configure o e-mail único, o hash gerado por `python backend/scripts/hash_password.py` e um segredo aleatório de pelo menos 32 bytes somente no ambiente do servidor; o mesmo segredo de sessão fica no ambiente server-side de Next.js e FastAPI. Em produção, use HTTPS e cookie Secure. A sessão expira após 30 dias sem atividade; não há rota de signup nem encerramento remoto global de sessões. Os SAS ficam apenas no backend; nunca os copie para o frontend. A configuração local não autoriza baixar CSVs: Pornhub permanece desligado e a declaração 18+ continua sendo apenas declaratória, não uma verificação de idade.

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
