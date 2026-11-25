// Report publishing endpoint for the scorebook.
//   PUT /r/<id>  (Authorization: Bearer <PUBLISH_KEY>)  body = standalone report HTML
//   GET /r/<id>  serves the report
// Report ids are 22 random characters generated on the tablet, so links are unguessable.
// Nothing is listed or indexed.

const ID = /^[a-z0-9]{16,40}$/;
const MAX_BYTES = 2 * 1024 * 1024;

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowed = env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN ? origin : env.ALLOWED_ORIGIN || '*';

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(allowed) });

    const m = url.pathname.match(/^\/r\/([^/]+)$/);
    if (!m || !ID.test(m[1])) return new Response('Not found', { status: 404 });
    const key = 'reports/' + m[1] + '.html';

    if (request.method === 'GET') {
      const obj = await env.REPORTS.get(key);
      if (!obj) return new Response('This report link is not valid.', { status: 404 });
      return new Response(obj.body, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Robots-Tag': 'noindex, nofollow',
          'Cache-Control': 'public, max-age=60',
          'Referrer-Policy': 'no-referrer',
        },
      });
    }

    if (request.method === 'PUT') {
      const auth = request.headers.get('Authorization') || '';
      if (!env.PUBLISH_KEY || auth !== 'Bearer ' + env.PUBLISH_KEY) {
        return new Response('Wrong publish key', { status: 401, headers: cors(allowed) });
      }
      const body = await request.text();
      if (body.length > MAX_BYTES) return new Response('Report too large', { status: 413, headers: cors(allowed) });
      await env.REPORTS.put(key, body, { httpMetadata: { contentType: 'text/html; charset=utf-8' } });
      return new Response(JSON.stringify({ url: url.origin + url.pathname }), {
        headers: { 'Content-Type': 'application/json', ...cors(allowed) },
      });
    }

    return new Response('Method not allowed', { status: 405 });
  },
};
