import * as cheerio from 'cheerio';
import fs from 'fs';
import db from '../server/db.js';

async function syncSites() {
    console.log('Fetching data from https://www.acgbox.link/ ...');
    
    try {
        const res = await fetch('https://www.acgbox.link/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            }
        });

        if (!res.ok) {
            console.error('Failed to fetch:', res.status, res.statusText);
            return;
        }

        const html = await res.text();
        const $ = cheerio.load(html);

        const results: any[] = [];
        $('.url-body').each((i, el) => {
            const a = $(el).find('a.card');
            const dataUrl = a.attr('data-url');
            let actualUrl = dataUrl;
            
            const togoHref = $(el).find('a.togo').attr('href');
            if (togoHref && togoHref.includes('?url=')) {
                 try { actualUrl = Buffer.from(togoHref.split('?url=')[1].replace(/%3D/g, '='), 'base64').toString('utf-8'); } catch(e){}
            }
            
            const cleanStr = (s?: string) => s ? s.replace(/\s+/g, ' ').trim() : '';

            const title = cleanStr(a.find('strong').text()) || cleanStr(a.attr('title'));
            const desc = cleanStr(a.find('p.text-muted').text());
            
            let iconUrl = a.find('img').attr('data-src') || a.find('img').attr('src');
            if (iconUrl && iconUrl.startsWith('//')) iconUrl = 'https:' + iconUrl;
            else if (iconUrl && iconUrl.startsWith('/')) iconUrl = 'https://www.acgbox.link' + iconUrl;

            // Remove any acgbox specific references for our clean slate version
            if (title.toLowerCase().includes('acg盒子') || title.toLowerCase().includes('acgbox')) {
               return; // skip
            }

            if (actualUrl && title) {
                results.push({ title, url: actualUrl, desc, iconUrl });
            }
        });

        console.log(`Found ${results.length} valid resources!`);

        let inserted = 0;
        const defaultCategoryId = 1; // Put imported items into first category by default
        const insertStmt = db.prepare(`
            INSERT INTO sites (name, url, description, category_id, tags, icon_url)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(url) DO NOTHING
        `);

        // Transaction to insert all
        const transaction = db.transaction((items) => {
          for (const item of items) {
            const res = insertStmt.run(
               item.title,
               item.url,
               item.desc || item.title,
               defaultCategoryId,
               JSON.stringify([]),
               item.iconUrl || null
            );
            if (res.changes > 0) inserted++;
          }
        });

        transaction(results);
        console.log(`Successfully populated ${inserted} new resources into the database!`);
    } catch (e) {
        console.error('Error during scraping and DB population:', e);
    }
}

syncSites();
