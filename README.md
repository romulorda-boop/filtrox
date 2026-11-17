# FILTROX — Cinema after dark

Site FILTROX com homepage de busca por catálogo e tags oficiais, catálogo editorial preservado em rota própria e busca federada PeerTube em rota separada. A homepage usa a identidade oficial preta/vermelha FILTROX.

## Páginas

| Rota | Conteúdo |
| --- | --- |
| `/` | Homepage FILTROX, categorias dinâmicas derivadas das tags oficiais, busca no endpoint `/api/catalog` e acesso à lista completa de tags. |
| `/rota-search/` | Busca federada SepiaSearch; exige confirmação declaratória de 18 anos e autorização explícita antes de enviar cada termo. |
| `/catalog/` | Catálogo editorial anterior, alimentado pelos CSVs do Azure Blob. |

A homepage e a busca federada mantêm acessos ao catálogo. O catálogo preserva pesquisa, coleções, ordenação, favoritos e reprodução de prévia original.

## Executar localmente

Requisito: Node.js 18 ou superior. O servidor não exige instalação de dependências locais.

```bash
npm start
```

Abra `http://localhost:3000`. Para usar outra porta, defina `PORT` antes de iniciar o servidor. O servidor estático serve `index.html` também em rotas de diretório, como `/catalog/`.

## Estrutura principal

- `public/index.html` — homepage FILTROX de busca e tags, com marca, hero e controles acessíveis.
- `public/home.js` e `public/home.css` — tags oficiais, busca no endpoint do catálogo e layout responsivo da homepage.
- `public/rota-search/` — cliente SepiaSearch, age gate, consentimentos, filtros, cartões e estilos responsivos.
- `public/catalog/index.html` — página do catálogo editorial preservada.
- `public/app.js` — carga dos CSVs do catálogo, remoções, pesquisa, filtros, favoritos e cartões.
- `public/data-config.js` — URLs, delimitadores e índices das colunas dos CSVs do Azure.
- `public/assets/filtrox-mark.svg` — marca oficial usada como favicon, logo e fallback dos cartões.
- `public/staticwebapp.config.json` — cabeçalhos de cache do Azure Static Web Apps.
- `public/manus-routes.json` — manifesto das rotas `/`, `/catalog/` e `/rota-search/`.
- `server.js` — servidor estático local em Node.js.
- `TODO.md` — entregas concluídas e pendências operacionais.

## Homepage e tags

A página `/` usa fundo preto, acentos vermelhos e a marca FILTROX. As categorias populares são calculadas em tempo de execução exclusivamente da coluna `tags` da base CSV, depois de cruzar e excluir as URLs do CSV de remoções. Os chips mostram tags ordenadas por frequência e levam a `/catalog/` com filtro exato; **Ver todas as tags** abre a lista completa pesquisável e paginada. A busca textual só é enviada ao endpoint `/api/catalog` após submissão do formulário, evitando carregar todos os resultados ao abrir a homepage. O endpoint recebe `q` e `sort` e lê o CSV pelo caminho ou URL configurado no servidor.

## Busca federada

A busca só é enviada quando a pessoa confirma a idade, marca a autorização de envio e submete o formulário. A requisição GET vai a `https://sepiasearch.org/api/v1/search/videos`; o termo é transmitido no parâmetro `search`, junto a `privacyOneOf=1`, `nsfw=true` e paginação de 50 itens. O termo não é colocado na URL da página nem salvo em cookies ou armazenamento local. Não há analytics.

A interface só exibe vídeos com `privacy.id === 1` e com o bit `2` (`EXPLICIT_SEX`) presente em `nsfwFlags`. As tags são derivadas dos resultados elegíveis carregados. Em **Incluir**, basta uma tag selecionada; **Excluir** remove qualquer vídeo que tenha uma tag selecionada. Duração e qualidade são filtros locais. A interface também oferece contagem de resultados, limpeza dos filtros e carregamento de páginas adicionais.

A duração aparece como `MM:SS` ou `HH:MM:SS`. Os cartões mostram a origem e, quando fornecida pela API, a qualidade. Miniaturas externas são opcionais e carregadas de forma lazy após autorização; em caso de falha, o cartão usa um fallback preto/vermelho com a marca FiltroX. O iframe é criado apenas após clique em **Reproduzir aqui**, sem autoplay, e há um link para a instância PeerTube original.

O SepiaSearch recebe a consulta. Ao autorizar miniaturas, abrir o player ou seguir o link original, o navegador também contata a instância de origem. As flags e metadados dependem das instâncias e podem estar ausentes ou incorretos. “Público” não garante ausência de senha, paywall ou cobrança externa. A confirmação de 18 anos é declaratória e não verifica identidade ou idade.

## Catálogo e CSVs do Azure

`/catalog/` busca em paralelo `xvideos_up.csv` (base) e `xvideos_remove.csv` (lista de remoções), usando PapaParse. Os arquivos não têm cabeçalho: a base usa `;` e a URL está na primeira coluna por padrão; a lista de remoções usa `|` e a URL está na segunda coluna por padrão. Esses índices e delimitadores são configuráveis em `public/data-config.js`. As URLs são normalizadas para cruzamento e vídeos presentes na lista de remoções são ocultados antes da renderização.

As chamadas usam `fetch(..., {cache: 'no-store'})`. A leitura direta pelo navegador depende de CORS para a origem publicada e de SAS de leitura válidos; como `data-config.js` é entregue ao navegador, as URLs SAS ficam visíveis, portanto devem ser apenas de leitura e restritas aos blobs necessários. Os SAS atualmente versionados expiraram em `2026-11-17T10:23:54Z` (remoções) e `2026-11-17T10:24:37Z` (base); novos SAS e CORS para o domínio publicado são necessários para carregar os CSVs. O catálogo editorial mantém os dados filtrados em memória e renderiza 48 cartões por página.

O arquivo local `data/videos.csv` é ignorado pelo Git. Mantenha arquivos de produção grandes no Blob Storage; `data/videos.sample.csv` serve apenas como amostra local.

## Verificações e publicação

Verificações manuais usadas no projeto incluem `node --check` para os arquivos JavaScript, `git diff --check`, validação HTTP das rotas/recursos e testes de navegador com respostas CSV simuladas. A publicação do site é disparada pelo workflow **Azure Static Web Apps CI/CD** em pushes para `main`; o conteúdo publicado vem de `public/`.
