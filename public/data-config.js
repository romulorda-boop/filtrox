/* Configuração não sensível da estrutura dos CSVs oficiais. URLs SAS somente no ambiente do servidor. */
window.FILTROX_CONFIG = Object.freeze({
  keyField: 'url',
  baseDelimiter: ';',
  removalDelimiter: '|',
  baseUrlColumn: 0,
  removalUrlColumn: 1,
  baseColumns: Object.freeze({
    title: 1,
    duration: 2,
    tags: 5,
    cast: 6,
    views: 7,
    category: 8,
    quality: 9,
    publisher: 10,
    uploadedAt: 12
  })
});
