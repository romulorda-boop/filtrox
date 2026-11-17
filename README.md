# FILTROX — Cinema after dark

Catálogo audiovisual demonstrativo com identidade FILTROX, conteúdo fictício e artes abstratas originais.

## Executar localmente

Requisitos: Node.js 18 ou superior. O projeto não precisa instalar dependências externas.

```bash
npm start
```

Abra `http://localhost:3000` no navegador. Para usar outra porta, defina a variável `PORT` antes de executar.

## Estrutura

- `public/` — página, estilos, interações, ícone e manifesto de rotas.
- `data/videos.csv` — registros do catálogo carregados no navegador via PapaParse.
- `server.js` — servidor estático Node.js.
- `package.json` — comando `npm start`.
- `app.config.ts` — metadados da marca no projeto Manus.
- `TODO.md` — escopo e estado da implementação.
