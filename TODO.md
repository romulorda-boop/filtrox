# TODO — FILTROX | Cinema After Dark

- [x] **Catálogo audiovisual responsivo com identidade original**
  - Criar um layout de catálogo audiovisual responsivo com atmosfera escura e identidade própria da FILTROX.
  - Adaptar integralmente para desktop, tablet e celular.
  - Evidência: página implementada com navegação responsiva e visualizações para telas grandes e pequenas.

- [x] **Navegação, busca e filtros do catálogo**
  - Disponibilizar navegação lateral com acesso às principais seções do catálogo.
  - Incluir no cabeçalho um campo de busca para localizar títulos e conteúdos.
  - Exibir filtros para refinar a grade por categorias ou atributos relevantes.
  - Evidência: seções de descobrir, em alta, adicionados e minha lista; busca e filtros de categoria/ordenação funcionais.

- [x] **Catálogo carregado de CSV no navegador**
  - Criar a pasta `data` na raiz e salvar nela o CSV dos vídeos (`/data/videos.csv`).
  - Incluir PapaParse 5.4.1 via CDN no `index.html`.
  - Carregar o CSV automaticamente ao abrir a página usando `Papa.parse` com `download: true` e `header: true`, alimentando a busca e os filtros.
  - Verificar que os dados são lidos corretamente na interface e no console, e fazer commit e push para `Colab3`.
  - Evidência: 12 linhas CSV válidas; navegador confirmou PapaParse ativo, 12 vídeos em memória e 12 cards; busca “Maré” retorna 1 resultado e o filtro Documentário retorna 4.

- [x] **Fonte externa configurável para catálogo pesado**
  - Carregar os dados por `fetch` a partir de uma URL configurável fora do código principal.
  - Manter o CSV de produção fora do controle de versão e usar um arquivo pequeno apenas como amostra local.
  - Documentar CORS e a evolução para API com paginação se a leitura completa no navegador ficar pesada.
  - Evidência: navegador confirmou `fetch` da URL configurada, PapaParse ativo, 12 registros em memória e 12 cards; a URL de produção Blob ainda depende de configuração do ambiente.

- [x] **Cruzar atualizações e remoções do Azure Blob**
  - Buscar `xvideos_up.csv` como base e `xvideos_remove.csv` como lista de remoções.
  - Usar a URL do vídeo como chave de cruzamento e ocultar da interface os registros correspondentes às remoções.
  - Evidência: a base real contém 13.751 linhas separadas por `;`; a lista de remoção contém 26.569 URLs em linhas `origem|url`. Teste local na interface com a base real e uma URL sintética correspondente confirmou 13.750 resultados e 1 ocultado; busca, categoria e paginação também passaram. Nos arquivos remotos atuais foram encontrados zero cruzamentos entre as URLs.

- [x] **Promover `Colab3` para `main` e acionar o deploy**
  - Commit da implementação em `Colab3`: `c955e64`; a branch também incorpora o workflow remoto de `main`.
  - Merge enviado para `main`: `32b87de`; GitHub Actions iniciou o workflow `Azure Static Web Apps CI/CD` (execução `44005519084`).

- [ ] **Validar CORS na origem publicada e renovar os SAS**
  - O navegador de preview da Sandbox não conseguiu fazer `fetch` dos blobs (`TypeError: Failed to fetch`), embora os downloads via HTTP direto funcionem; confirmar que a origem real do Azure Static Web Apps está autorizada no CORS do Blob.
  - Os SAS configurados vencem em 2026-11-17 10:23Z; renová-los antes do vencimento para manter o catálogo disponível.

- [x] **Grade e interações dos cards**
  - Exibir uma grade responsiva de cards de vídeo com imagem, título e metadados essenciais.
  - Implementar estados interativos de cards e controles, incluindo hover, foco e seleção.
  - Evidência: grade preenchida com conteúdo fictício original, arte abstrata em CSS, metadados, foco visível e controles de favoritos.

- [x] **Detalhes e reprodução**
  - Oferecer página ou modal de detalhes com sinopse, informações e ação de reprodução.
  - Disponibilizar reprodução ou prévia de conteúdo seguro e não explícito em uma interface de vídeo própria.
  - Evidência: modal acessível com sinopses, metadados, coleções e player canvas de prévia visual original, com play/pausa, busca de tempo e tela cheia.

- [x] **Conteúdo e propriedade intelectual seguros**
  - Usar exclusivamente textos, marcas, imagens e vídeos originais ou licenciados.
  - Não reproduzir conteúdo proprietário da referência enviada no ZIP.
  - Evidência: identidade FILTROX e títulos fictícios originais; grafismos abstratos próprios; sem incorporação de material da cópia de referência.

Verificações concluídas: `node --check` para JavaScript/servidor; respostas HTTP 200 para `/`, CSS, JavaScript, ícone e manifesto `/manus-routes.json`.
