/*
 * URLs de leitura direta para o navegador. Os SAS são visíveis aos visitantes e expiram em
 * 2026-11-17 10:23:54Z (remoção) e 10:24:37Z (base); renove antes do vencimento.
 */
window.FILTROX_CONFIG = Object.freeze({
  baseCsvUrl: 'https://filtroxdata.blob.core.windows.net/filtroxdata/xvideos_up.csv?sp=r&st=2026-11-17T02:09:37Z&se=2026-11-17T10:24:37Z&spr=https&sv=2026-02-06&sr=b&sig=rzVUJgstbuElfJbAhbrBBTGYlPNqFzS59xT8yaovJA8%3D',
  removalCsvUrl: 'https://filtroxdata.blob.core.windows.net/filtroxdata/xvideos_remove.csv?sp=r&st=2026-11-17T02:08:54Z&se=2026-11-17T10:23:54Z&spr=https&sv=2026-02-06&sr=b&sig=6GCzvOBLHdkUQ1e0WE5le9GYmkEJ0xKcBfRG%2FvEQUww%3D',
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
