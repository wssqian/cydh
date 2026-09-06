import fs from 'fs';
import * as cheerio from 'cheerio';

const html = fs.readFileSync('acgbox.html', 'utf-8');
const $ = cheerio.load(html);
const links: any[] = [];
$('.url-card').each((i, el) => {
    links.push($(el).html());
});

console.log("URL CARDS:");
console.log(links.slice(0, 2).join('\n---\n'));

if (links.length === 0) {
   const classNames: any = {};
   $('*').each((i, el) => {
      const cls = $(el).attr('class');
      if (cls) {
         classNames[cls] = (classNames[cls] || 0) + 1;
      }
   });
   const sorted = Object.entries(classNames).sort((a: any, b: any) => b[1] - a[1]).slice(0, 20);
   console.log("Top class names:", sorted);
}
