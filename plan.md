# Plano — Homepage FILTROX por tags oficiais

## Escopo e comportamento

Redesenhar apenas a rota `/` usando a imagem móvel enviada como referência de composição. Preservar `/catalog/`, `/rota-search/`, o endpoint `/api/catalog` e os contratos existentes de busca e ordenação. O formulário da homepage envia a consulta à API apenas após submissão; a homepage não deve renderizar uma lista inteira de vídeos antes da busca.

As categorias populares são derivadas exclusivamente da coluna `tags` da base oficial CSV. O carregador busca base e remoções com `cache: 'no-store'`, normaliza as URLs, exclui registros removidos e deduplica tags por vídeo. Exibir até 18 tags ordenadas pela frequência calculada; seus chips e itens da lista completa abrem `/catalog/?tag=...`. A lista completa permanece pesquisável e carregada em lotes, sem valores inventados.

## Direção visual

Usar uma estética editorial cinematográfica inspirada na composição da referência: cabeçalho enxuto, hero central com marca FILTROX e busca proeminente, seção de categorias com chips, resultados sob demanda e margens generosas. O fundo é preto/carvão; vermelho FILTROX identifica ações, foco e estados ativos, com cinzas neutros para texto secundário. Reutilizar o símbolo oficial e o wordmark textual, sem criar marca alternativa. A tipografia sans-serif deve ser legível em celular; metadados podem usar monoespaçada. Transições são discretas e respeitam `prefers-reduced-motion`.

## Arquivos e responsabilidades

- `public/index.html`: hierarquia semântica do cabeçalho, hero, busca, categorias populares, lista expansível, resultados e rodapé.
- `public/home.css`: paleta preta/vermelha, tipografia, margens, estados e breakpoints responsivos.
- `public/home.js`: carga e cruzamento das tags/remoções, chips populares, pesquisa incremental de tags e chamada existente a `/api/catalog`.
- `public/data-config.js`: manter URLs, delimitadores e índices atuais; não replicar tokens SAS em arquivos ou logs.
- `public/assets/filtrox-mark.svg`: aplicar o vermelho à marca oficial reutilizada como ícone e logo.
- `README.md` e `TODO.md`: documentar a apresentação, validação e as limitações operacionais atuais.
- `/catalog/`, `/rota-search/`, `api/catalog/`, `public/manus-routes.json` e o workflow Azure permanecem com seus contratos e rotas.

## Limite operacional conhecido

O navegador precisa de CORS para a origem publicada e de URLs Blob com SAS de leitura válido; essas URLs ficam públicas quando usadas no frontend. Os SAS atualmente configurados já expiraram, então validar com CSVs locais não confirma o funcionamento da produção. Não promover para `main` até receber novos SAS de leitura e confirmar o acesso de produção.
