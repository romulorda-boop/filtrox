# FILTROX — protótipo em revisão, sem publicação em produção

A branch `colab1` contém a aplicação local do FILTROX: frontend Next.js e backend FastAPI. Todas as páginas privadas e APIs exigem login com sessão assinada; não há cadastro público. Esta revisão atualiza o PR #5 para avaliação, sem autorização para merge, deploy em produção ou provisionamento. O push deve ocorrer com o workflow Azure temporariamente pausado para impedir um novo preview e reativado em seguida. O histórico do PR registra uploads Azure bem-sucedidos em revisões anteriores, seguidos por execuções do job de fechamento; esta tarefa não autoriza nova publicação. Os CSVs reais não foram baixados, abertos ou analisados, e a hospedagem de produção continua sendo a versão antiga.

## Fontes planejadas

**Xvideos — ativo no código.** O backend lê somente `xvideos_up.csv` e `xvideos_remove.csv` do Azure Blob, por URLs server-side de leitura e caminhos exatos. A lista de removidos é aplicada antes de busca e facetas; o SAS não chega ao navegador.

**Pornhub — planejado, ainda desligado.** O SAS de leitura de `pornhub_up.csv` foi guardado em `backend/.env.local`, ignorado pelo Git. `FILTROX_ENABLE_PORNHUB=false` é o default; se alguém tentar ativá-lo, o backend falha fechado antes do Redis, SAS ou rede. Ainda falta confirmar o formato oficial do arquivo, a política de remoções e os controles de privacidade. Nenhum parser foi habilitado e nenhum arquivo Pornhub foi acessado. A documentação oficial do [portal Webmasters](https://www.pornhub.com/webmasters) e da [seção oficial de Webmasters](https://help.pornhub.com/hc/en-us/sections/4419836305043-Webmasters) não substitui a validação do formato exato do CSV.

Não há scraping nem contorno de bloqueios. O botão Play abre somente uma URL HTTPS validada do Xvideos, depois de ação explícita do usuário; não há player incorporado Pornhub ativo.

## Implementação e testes locais

A aplicação inclui busca estrita por palavras completas, frases ordenadas, filtros, equivalências manuais, ordenação primária/secundária, paginação limitada a 30 itens e rotas server-side de histórico/favoritos isoladas por conta. A inclusão de várias tags pode exigir todas (AND, padrão) ou qualquer uma (OR); as exclusões sempre rejeitam itens com qualquer tag excluída. Facetas agrupam apenas rótulos de tag exatamente iguais entre fontes, contam vídeos distintos no conjunto completo de resultados (não apenas na página) e mantêm idiomas separados. Não há tradução automática; equivalências só são usadas quando escolhidas explicitamente. A opção Limpar tudo reinicia a busca e os filtros na primeira página. O histórico pode ser apagado; o cliente não grava esses registros em `localStorage`.

O backend usa Meilisearch privado para selecionar candidatos, mas a validação final continua nas regras estritas Python já existentes. O índice guarda somente o ID e fingerprints HMAC dos tokens, calculados com uma chave server-side; não guarda título, tags, URL nem dados pessoais. O backend aplica as remoções no carregador antes da sincronização e substitui o conteúdo antigo do índice quando o catálogo muda. A busca do Meilisearch é limitada a 10.000 candidatos; nesse limite, o backend faz a varredura exata local para não truncar resultados. A sincronização tem lock apenas dentro de um processo: hospedagem com múltiplos workers ainda exige coordenação distribuída ou troca atômica de índices e não está pronta para produção.

O carregador Xvideos tem limites de bytes/registros, streaming, remoção antes das facetas e cache. PostgreSQL remoto exige TLS; confirmação do certificado e a infraestrutura ainda precisam ser definidas. O login usa o único e-mail configurado no ambiente privado e um hash PBKDF2 bootstrap; após a migração manual `002_admin_credentials.sql`, a nova senha é guardada somente como hash PBKDF2 na tabela singleton do PostgreSQL. A tela autenticada `/settings` exige a senha atual e não permite mudar e-mail. A troca depende do banco e da migração, que ainda não foram aplicados em PostgreSQL real. A sessão é assinada por segredo compartilhado apenas entre Next.js e FastAPI; cada acesso autenticado renova a sessão, que expira após 30 dias sem atividade. Alterar a senha não encerra sessões abertas nem adiciona logout remoto global. Credenciais ausentes causam falha fechada. Não existe signup público. A declaração 18+ aparece depois do login como camada declaratória separada e não verifica nem comprova idade.

O histórico e os favoritos são persistidos em PostgreSQL por `actor_id` estável calculado pelo backend a partir do e-mail do único admin autenticado; todas as consultas são escopadas por essa chave. Não há cadastro público e nenhuma senha é persistida em texto puro. As migrações `001_init.sql` e `002_admin_credentials.sql` definem, respectivamente, dados pessoais e o hash da senha única. As rotas autenticadas `/v1/me/history/export` e `/v1/me/favorites/export` permitem baixar CSV ou JSON usando `?format=csv` ou `?format=json`; os arquivos incluem somente ID, URL, fonte e data do registro, nunca credenciais, tokens ou o catálogo. A exportação lê todas as linhas do admin e não aceita identificador de conta do cliente. Ela depende de PostgreSQL provisionado e migrações aplicadas; o banco ainda não foi provisionado, portanto a exportação não está disponível em uma instância sem armazenamento. Migrações **não** rodam no startup: use `PYTHONPATH=backend python3 backend/scripts/migrate.py` somente com `DATABASE_URL` explicitamente exportada e após revisar o destino. O comando registra cada versão e recusa alterar tabelas existentes sem histórico de migrações. Nenhuma hospedagem foi escolhida; não há rotina de backup automática ou agendada.

### Backups PostgreSQL — manuais, criptografados e salvos localmente

Na tela autenticada `/settings`, o administrador inicia cada exportação manualmente. O backend encadeia `pg_dump`→`age` em pipes e transmite somente o arquivo criptografado ao navegador; não grava dump em claro, não cria arquivo de backup no servidor, não mantém retenção e não executa cron ou rotina automática. O navegador baixa o `.dump.age` para que o proprietário o salve no aparelho/local escolhido. O CLI legado de backup está desativado para impedir cópias no backend.

O backend aprovado precisará de `FILTROX_BACKUP_AGE_RECIPIENT` (somente a chave pública), `DATABASE_URL` com `sslmode=verify-full`, e `age`/`pg_dump` confiáveis em `/usr/bin` ou `/bin`. A chave privada correspondente fica sob controle local do proprietário, nunca no backend; guarde-a em segurança e separada dos arquivos de backup. Sem ela não se abre o arquivo. Com senha no DSN, o sistema requer Linux com `memfd_create` e `/proc/self/fd`, usando passfile anônimo em memória e sem `PGPASSWORD` ou arquivo temporário. Nenhuma hospedagem foi escolhida e nenhuma chave foi configurada, então a exportação ainda não está disponível. Nenhum banco ou binário de backup real foi usado nesta tarefa.

A restauração permanece bloqueada: falta um fluxo compatível com arquivo local que descriptografe com a chave privada local e, antes de restaurar, entregue e permita guardar localmente um backup criptografado pré-restauração. O endpoint não pode ser habilitado por uma flag. Nenhuma conexão a banco real, `pg_dump`, `pg_restore`, scheduler ou serviço externo foi executado.

Os testes usam somente dados sintéticos, sem chamadas a Azure, Xvideos, Pornhub, provedores de login ou banco real:

```bash
PYTHONPATH=backend /tmp/filtrox-venv/bin/python -m unittest discover -s backend/tests -v
/tmp/filtrox-venv/bin/python -m compileall -q backend/app backend/tests
cd web && npm run lint && npm run build && npm audit --audit-level=high
```

## Executar localmente

Use `backend/.env.example` e `web/.env.example` como referências. Configure o e-mail único, o hash gerado por `python backend/scripts/hash_password.py` e um segredo aleatório de pelo menos 32 bytes somente no ambiente do servidor; o mesmo segredo de sessão fica no ambiente server-side de Next.js e FastAPI. Em produção, use HTTPS e cookie Secure. A sessão expira após 30 dias sem atividade; não há rota de signup nem encerramento remoto global de sessões. Os SAS ficam apenas no backend; nunca os copie para o frontend. A configuração local não autoriza baixar CSVs: Pornhub permanece desligado e a declaração 18+ continua sendo apenas declaratória, não uma verificação de idade.

Para o desenvolvimento local, configure `MEILI_API_KEY` (mínimo de 16 caracteres) e `POSTGRES_PASSWORD` somente no arquivo local ignorado pelo Git; depois inicie os serviços, expostos apenas em loopback:
```bash
docker compose --env-file backend/.env.local -f docker-compose.local.yml up -d postgres redis meilisearch
```
O Meilisearch é obrigatório para a rota de busca e a chave nunca é enviada ao navegador. Em produção use HTTPS e uma chave de servidor com permissões restritas ao índice; nunca reutilize a chave master local. A integração foi validada por testes sintéticos com transporte HTTP simulado, não por conexão a uma instância real.

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

O backup manual está disponível na tela `/settings` quando ferramentas, PostgreSQL e a chave pública age estiverem configurados no backend aprovado. Cada clique inicia uma exportação e o navegador recebe o `.dump.age`; não há diretório/retention de backups no servidor nem agendamento. A restauração segue bloqueada até haver upload de arquivo local e backup prévio também baixado/guardado localmente. Nesta etapa, não há host escolhido e não executamos operação em banco real.
