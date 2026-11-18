const { getCatalog } = require('./catalog');

module.exports = async function catalog(context, req) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.ageConfirmed !== true) {
      context.res = {
        status: 403,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        body: { error: 'Confirmação 18+ necessária.' }
      };
      return;
    }
    const payload = await getCatalog({
      query: body.query ?? req.query?.q ?? '',
      sort: body.sort ?? req.query?.sort ?? 'recent',
      tag: body.tag ?? '',
      mode: body.mode ?? 'search',
      offset: body.offset ?? req.query?.offset ?? 0,
      limit: body.limit ?? req.query?.limit ?? 48
    });
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: payload
    };
  } catch (error) {
    context.log?.error?.(`Catálogo indisponível (${error.name || 'erro'}).`);
    context.res = {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: { error: 'Catálogo oficial indisponível.' }
    };
  }
};
