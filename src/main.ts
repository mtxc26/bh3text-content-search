import { AutoRouter } from 'itty-router';
import notFoundHtml from './pages/404.html';
import { handleSearch } from './handlers/search.js';

const CSP = "frame-ancestors 'self'; base-uri 'self'; manifest-src 'self'; script-src-attr 'none'; script-src 'self' https://staticassets.bh3text.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' data:; child-src 'self' https: blob: data:; worker-src 'self'; font-src 'self' https://staticassets.bh3text.com";

export default {
  async fetch(request: Request, env: any) {

    const router = AutoRouter();

    router.get('/search/', req => handleSearch(req, env));
    router.all('*', (request: Request) => {
      const url = new URL(request.url);
      return new Response(notFoundHtml, {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    });

    let response = await router.fetch(request);
    if (!response) {
      response = await env.ASSETS.fetch(request);
    }
    response.headers.set('Content-Security-Policy', CSP);
    response.headers.set('x-xss-protection', '0');
    return response;
  }
};
