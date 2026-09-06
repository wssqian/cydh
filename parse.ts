import * as cheerio from 'cheerio';
import fs from 'fs';
import db from './server/db.js';

const html = fs.readFileSync('acgbox.html', 'utf-8');
const $ = cheerio.load(html);

const results: any[] = [];
$('.url-body').each((i, el) => {
    const a = $(el).find('a.card');
    const dataUrl = a.attr('data-url');
    let actualUrl = dataUrl;
    
    // Sometimes there's a go link
    const togoHref = $(el).find('a.togo').attr('href');
    if (togoHref && togoHref.includes('?url=')) {
         try { actualUrl = Buffer.from(togoHref.split('?url=')[1].replace(/%3D/g, '='), 'base64').toString('utf-8'); } catch(e){}
    }
    
    // Clean string helper
    const cleanStr = (s?: string) => s ? s.replace(/\s+/g, ' ').trim() : '';

    const title = cleanStr(a.find('strong').text()) || cleanStr(a.attr('title'));
    const desc = cleanStr(a.find('p.text-muted').text());
    
    let iconUrl = a.find('img').attr('data-src') || a.find('img').attr('src');
    if (iconUrl && iconUrl.startsWith('//')) iconUrl = 'https:' + iconUrl;
    else if (iconUrl && iconUrl.startsWith('/')) iconUrl = 'https://www.acgbox.link' + iconUrl;

    if (actualUrl && title) {
        results.push({ title, url: actualUrl, desc, iconUrl });
    }
});

console.log(`Found ${results.length} valid resources!`);

import Database from 'better-sqlite3';
import path from 'path';

let inserted = 0;
const defaultCategoryId = 1;
const insertStmt = db.prepare(`
    INSERT INTO sites (name, url, description, category_id, tags, icon_url)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO NOTHING
`);

const transaction = db.transaction((items) => {
  for (const item of items) {
    const res = insertStmt.run(
       item.title,
       item.url,
       item.desc || item.title,
       defaultCategoryId, // For simplicity we put everything under the first category.
       JSON.stringify([]),
       item.iconUrl || null
    );
    if (res.changes > 0) inserted++;
  }
});

transaction(results);
console.log(`Inserted ${inserted} new resources into the DB!`);
