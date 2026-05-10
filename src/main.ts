import { AutoRouter } from 'itty-router';
import helpHtml from "./pages/help.html"
import { handleSearch } from './handlers/search.js';

const router = AutoRouter();

// Search endpoint
router.get('/search', handleSearch);

// Help page
router.get('/search/help', () => {
  const html = helpHtml;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
});

// No catch-all: unmatched requests fall through to static assets
export default router;
