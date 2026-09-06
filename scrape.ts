import * as cheerio from 'cheerio';
import db from './server/db'; // Make sure this path is correct, or just use bare db init

async function run() {
  const res = await fetch('https://www.acgbox.link/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
    }
  });
  if (!res.ok) {
    console.error('Failed to fetch:', res.status, res.statusText);
    return;
  }
  const html = await res.text();
  console.log('HTML length:', html.length);
  
  // write to a file to inspect
  import('fs').then(fs => fs.writeFileSync('acgbox.html', html));
}
run();
