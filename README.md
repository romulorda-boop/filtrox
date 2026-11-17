# FILTROX — Cinema after dark

Catálogo FILTROX com arte abstrata original e metadados carregados dos CSVs de vídeo hospedados no Azure Blob Storage.

## Executar localmente

Requisitos: Node.js 18 ou superior. O projeto não precisa instalar dependências externas.

```bash
npm start
```

Abra `http://localhost:3000` no navegador. Para usar outra porta, defina a variável `PORT` antes de executar.

## Estrutura

- `public/` — página, estilos, interações, ícone e manifesto de rotas.
- `public/data-config.js` — URLs e esquema dos arquivos CSV do Azure.
- `data/videos.sample.csv` — amostra pequena para referência local; não é a fonte de produção.
- `server.js` — servidor estático Node.js.
- `package.json` — comando `npm start`.
- `app.config.ts` — metadados da marca no projeto Manus.
- `TODO.md` — escopo e estado da implementação.

## Fonte CSV e cruzamento

O navegador busca em paralelo `xvideos_up.csv` (base) e `xvideos_remove.csv` (lista de remoções), usando PapaParse. Os arquivos atuais não têm linha de cabeçalho: a base usa `;` e tem a URL do vídeo na coluna 1; o arquivo de remoções usa `|`, inclui um campo de origem e a URL costuma estar na coluna 2. O carregador também procura uma URL HTTP(S) em cada linha como fallback. As chaves são normalizadas e qualquer URL da base que também esteja na lista de remoções é omitida antes da renderização.

A grade renderiza 48 cards por página, mas mantém os registros filtrados em memória para que busca e categorias sejam globais. Se o volume crescer muito além do atual, a próxima etapa recomendada é uma API com consulta e paginação no servidor; dividir CSVs em arquivos sem particionar as consultas ainda exige baixá-los para filtros globais.

## Acesso Azure e segurança

O carregamento direto pelo navegador exige CORS configurado para as origens reais do site e o método `GET`. As URLs SAS são entregues ao navegador e, portanto, ficam visíveis aos visitantes; use apenas SAS de leitura (`sp=r`) restrito aos blobs necessários, nunca uma chave de conta nem permissões de escrita/exclusão. Os SAS atualmente configurados expiram em `2026-11-17T10:23:54Z` (remoções) e `2026-11-17T10:24:37Z` (base); substitua-os antes do vencimento para evitar que o catálogo deixe de carregar.

O caminho local `data/videos.csv` é ignorado pelo Git; mantenha arquivos de produção grandes no Blob e não os versione no repositório.
