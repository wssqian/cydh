import * as cheerio from 'cheerio';
import db from '../server/db.js';

async function fetchPage(url: string) {
    console.log(`Fetching ${url} ...`);
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;'
        }
    });
    if (!res.ok) throw new Error(`Failed to fetch ${url}`);
    return res.text();
}

async function run() {
    const urls = [
        'https://www.acgbox.link/',
        'https://www.acgbox.link/yingyinzhuanqu',
        'https://www.acgbox.link/yuledaohang',
        'https://www.acgbox.link/shiyongruanjian',
        'https://www.acgbox.link/gongjudaquan',
        'https://www.acgbox.link/wangzhiguidang'
    ];

    const getCat = db.prepare('SELECT id FROM categories WHERE name = ?');
    const getMaxCatId = db.prepare('SELECT MAX(id) as maxId FROM categories');
    const insertCat = db.prepare('INSERT INTO categories (id, name, slug, icon, sort_order) VALUES (?, ?, ?, ?, ?)');
    const insertSite = db.prepare(`
        INSERT INTO sites (name, url, description, category_id, tags, icon_url)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(url) DO NOTHING
    `);

    const iconMap: Record<string, string> = {
        '次元美图': 'Image', '在线动漫': 'PlaySquare', '动漫下载': 'DownloadCloud',
        '在线漫画': 'BookOpen', '日轻小说': 'BookText', 'ACG资源': 'PackageOpen',
        'ACG游戏': 'Gamepad2', 'ACG社区': 'Users', 'ASMR': 'Headphones',
        'ACG网盘': 'HardDrive', '磁力资源': 'Magnet', '在线本子': 'Flame',
        '在线影视': 'Film', '在线音乐': 'Music', '短视频': 'Video',
        '直播平台': 'Tv', '电台频道': 'Radio', '网购平台': 'ShoppingCart',
        '社交资讯': 'MessageCircle', '设计素材': 'Palette', '求职招聘': 'Briefcase',
        '电脑软件': 'Monitor', '手机软件': 'Smartphone', '浏览器插件': 'Puzzle',
        '在线工具': 'Wrench', '站长工具': 'Globe', 'AI工具': 'Bot',
        '网址归档': 'Archive', '更多工具': 'MoreHorizontal'
    };

    const slugs: Record<string, string> = {
        '次元美图': 'art', '在线动漫': 'anime-online', '动漫下载': 'anime-download',
        '在线漫画': 'manga', '日轻小说': 'light-novel', 'ACG资源': 'acg-resources',
        'ACG游戏': 'acg-games', 'ACG社区': 'acg-community', 'ASMR': 'asmr',
        'ACG网盘': 'acg-drives', '磁力资源': 'magnet', '在线本子': 'doujin',
        '在线影视': 'movies', '在线音乐': 'music', '短视频': 'short-video',
        '直播平台': 'live', '电台频道': 'radio', '网购平台': 'shopping',
        '社交资讯': 'social', '设计素材': 'design', '求职招聘': 'jobs',
        '电脑软件': 'pc-soft', '手机软件': 'mobile-soft', '浏览器插件': 'plugins',
        '在线工具': 'online-tools', '站长工具': 'webmaster-tools', 'AI工具': 'ai-tools',
        '网址归档': 'archive'
    };

    const transaction = db.transaction((html: string) => {
        const $ = cheerio.load(html);
        $('h4.text-gray').each((i, h4) => {
            const catName = $(h4).text().trim();
            if (catName === '友情链接' || !catName) return;

            // Check if already exists in categories table by checking db directly?
            // Actually it's easier to keep a global map of processed categories to avoid duplicate IDs for same name across pages
            return;
        });
    });

    const categoryDocs: Record<string, { id: number, slug: string, icon: string, sort_order: number }> = {};

    for (const url of urls) {
        let html;
        try {
            html = await fetchPage(url);
        } catch (e) {
            console.error(e);
            continue;
        }
        
        db.transaction(() => {
            const $ = cheerio.load(html);
            $('h4.text-gray').each((i, h4) => {
                const catName = $(h4).text().trim();
                if (catName === '友情链接' || catName === '广告位' || !catName) return;
                
                let currentCatId;
                const existing = getCat.get(catName) as { id: number } | undefined;
                
                if (categoryDocs[catName]) {
                    currentCatId = categoryDocs[catName].id;
                } else if (existing) {
                    currentCatId = existing.id;
                    categoryDocs[catName] = { id: currentCatId, slug: slugs[catName] || `cat-${currentCatId}`, icon: iconMap[catName] || 'LayoutTemplate', sort_order: currentCatId };
                } else {
                    const maxDbId = (getMaxCatId.get() as { maxId: number | null }).maxId || 0;
                    currentCatId = maxDbId + 1;
                    const slug = slugs[catName] || `cat-${currentCatId}`;
                    const icon = iconMap[catName] || 'LayoutTemplate';
                    categoryDocs[catName] = { id: currentCatId, slug, icon, sort_order: currentCatId };
                    insertCat.run(currentCatId, catName, slug, icon, currentCatId);
                }

                const row = $(h4).closest('.d-flex').next('.row');
                
                // If it's a sub-page, sometimes row is not after a .d-flex. It might be nextAll('.row') or similar.
                let targetRow = row;
                if (targetRow.length === 0) {
                    targetRow = $(h4).closest('.border-theme').nextAll('.row').first();
                }

                targetRow.find('.url-body').each((_, el) => {
                    const a = $(el).find('a.card');
                    let actualUrl = a.attr('data-url');
                    
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

                    if (title.toLowerCase().includes('acg盒子') || title.toLowerCase().includes('acgbox')) {
                       return; 
                    }

                    if (actualUrl && title) {
                        insertSite.run(
                            title, actualUrl, desc || title, currentCatId, JSON.stringify([]), iconUrl || null
                        );
                    }
                });
            });
        })();
    }

    console.log('Database reconstructed with all requested sections.');
}

run();
