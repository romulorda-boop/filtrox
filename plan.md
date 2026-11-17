# Plano — navegação e tags do catálogo FiltroX

## Escopo aprovado

Reestruturar a página `/catalog/`. A homepage `/` continuará sendo o portal de busca SepiaSearch, e `/rota-search/` continuará como seu alias. A navegação de catálogo será alterada dentro da rota já existente, sem criar uma página ou rota nova.

## Estrutura existente

- `public/catalog/index.html` contém o menu lateral, campo de busca, grade e controles do catálogo.
- `public/app.js` baixa os CSVs oficiais configurados, aplica remoções, transforma os campos, filtra, ordena e renderiza a grade.
- `public/styles.css` contém o tema FiltroX, a sidebar e os breakpoints atuais.
- `public/data-config.js` mapeia a base CSV: URL 0, título 1, duração 2, tags 5, elenco 6, visualizações 7, categoria 8, qualidade 9, publicador 10 e data de envio 12. As URLs SAS não devem aparecer neste plano ou em logs.

## Comportamento e regras de dados

O menu do catálogo terá as entradas “Mais recentes”, “Mais vistos”, “Mais comentados”, “Melhor avaliação” e “Todas as tags”. “Mais recentes” ordenará pelo campo real `uploadedAt` (coluna 12) e “Mais vistos” por `views` (coluna 7). O código atual não mapeia contagem de comentários e usa o marcador constante `—` para avaliação; as duas entradas ficarão visíveis, mas desabilitadas e identificadas como indisponíveis até que o CSV oficial forneça esses campos. Nenhuma métrica será simulada.

A lista “Todas as tags” será expansível e derivada apenas dos valores da coluna `tags` (coluna 5) da base oficial, considerando os registros que permanecem após a lista oficial de remoções. Não usar elenco (coluna 6), categorias, exemplos locais ou termos fixos como fontes de tags. Deduplicar sem inventar valores. Clicar numa tag preencherá a busca existente e mostrará os vídeos correspondentes, preservando a pesquisa por texto atual.

## Implementação

Reutilizar o tema escuro/editorial, o mecanismo de sidebar atual, o estado e o campo de busca existentes. Alterar somente a marcação da página do catálogo, o controlador do catálogo e seus estilos responsivos. Manter a navegação móvel acessível por teclado e os controles existentes. Não alterar o portal `/`, o alias `/rota-search/`, os dados/configuração Azure ou o manifesto de rotas.
