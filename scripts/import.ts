import * as cheerio from 'cheerio';
import fs from 'fs';
import db from '../server/db.js';

async function run() {
    const html = fs.readFileSync('acgbox.html', 'utf-8');
    const $ = cheerio.load(html);

    // Clear DB
    db.prepare('DELETE FROM sites').run();
    db.prepare('DELETE FROM categories').run();

    let catId = 1;

    const insertCat = db.prepare('INSERT INTO categories (id, name, slug, icon, sort_order) VALUES (?, ?, ?, ?, ?)');
    const insertSite = db.prepare(`
        INSERT INTO sites (name, url, description, category_id, tags, icon_url)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(url) DO NOTHING
    `);

    // Map names to icon generic names
    const iconMap: Record<string, string> = {
        '次元美图': 'Image',
        '在线动漫': 'PlaySquare',
        '动漫下载': 'DownloadCloud',
        '在线漫画': 'BookOpen',
        '日轻小说': 'BookText',
        'ACG资源': 'PackageOpen',
        'ACG游戏': 'Gamepad2',
        'ACG社区': 'Users',
        'ASMR': 'Headphones',
        'ACG网盘': 'HardDrive',
        '磁力资源': 'Magnet',
        '在线本子': 'Flame',
        '友情链接': 'Link'
    };

    const slugs: Record<string, string> = {
        '次元美图': 'art',
        '在线动漫': 'anime-online',
        '动漫下载': 'anime-download',
        '在线漫画': 'manga',
        '日轻小说': 'light-novel',
        'ACG资源': 'acg-resources',
        'ACG游戏': 'acg-games',
        'ACG社区': 'acg-community',
        'ASMR': 'asmr',
        'ACG网盘': 'acg-drives',
        '磁力资源': 'magnet',
        '在线本子': 'doujin',
        '友情链接': 'links'
    };

    const transaction = db.transaction(() => {
        $('h4.text-gray').each((i, h4) => {
            const catName = $(h4).text().trim();
            if (catName === '友情链接') return; // Skip links

            const slug = slugs[catName] || `cat-${catId}`;
            const icon = iconMap[catName] || 'LayoutTemplate';

            insertCat.run(catId, catName, slug, icon, catId);

            const row = $(h4).closest('.d-flex').next('.row');
            
            row.find('.url-body').each((_, el) => {
                const a = $(el).find('a.card');
                let actualUrl = a.attr('data-url');
                
                const togoHref = $(el).find('a.togo').attr('href');
                if (togoHref && togoHref.includes('?url=')) {
                     try { actualUrl = Buffer.from(togoHref.split('?url=')[1].replace(/%3D/g, '='), 'base64').toString('utf-8'); } catch(e){}
                }
                
                const cleanStr = (s?: string) => s ? s.replace(/\\s+/g, ' ').trim() : '';
    
                const title = cleanStr(a.find('strong').text()) || cleanStr(a.attr('title'));
                const desc = cleanStr(a.find('p.text-muted').text());
                
                let iconUrl = a.find('img').attr('data-src') || a.find('img').attr('src');
                if (iconUrl && iconUrl.startsWith('//')) iconUrl = 'https:' + iconUrl;
                else if (iconUrl && iconUrl.startsWith('/')) iconUrl = 'https://www.acgbox.link' + iconUrl;
    
                // Filter ACGBox stuff
                if (title.toLowerCase().includes('acg盒子') || title.toLowerCase().includes('acgbox')) {
                   return; // skip
                }
    
                if (actualUrl && title) {
                    insertSite.run(
                        title, actualUrl, desc || title, catId, JSON.stringify([]), iconUrl || null
                    );
                }
            });

            catId++;
        });
    });

    transaction();
    console.log('Database reconstructed with acgbox.link categories.');
}

run();
