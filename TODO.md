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
