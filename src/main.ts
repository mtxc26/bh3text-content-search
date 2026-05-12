import { AutoRouter } from 'itty-router';
import helpHtml from './pages/help.html';
import notFoundHtml from './pages/404.html';
import { handleSearch } from './handlers/search.js';

export default {
  async fetch(request: Request, env: any) {

    const router = AutoRouter();

    router.get('/search/', req => handleSearch(req, env));
    router.get('/search/help', () => new Response(helpHtml, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=604800' },
    }));

    router.all('*', (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/all/')) return;
      return new Response(notFoundHtml, {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    });

    return router.fetch(request) || env.ASSETS.fetch(request);
  }
};
