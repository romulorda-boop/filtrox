const { getCatalog } = require('./catalog');

module.exports = async function catalog(context, req) {
  try {
    const items = await getCatalog({
      query: req.query?.q || '',
      sort: req.query?.sort || 'recent',
    });
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: { items, total: items.length },
    };
  } catch (error) {
    context.log.error(error);
    context.res = {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: { error: 'Catálogo indisponível.' },
    };
  }
};
