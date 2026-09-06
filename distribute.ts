import Database from 'better-sqlite3';

const db = new Database('data/nav.db');

const insertCat = db.prepare('INSERT OR IGNORE INTO categories (name, slug, icon, sort_order) VALUES (?, ?, ?, ?)');
insertCat.run('次元美图', 'art', 'Image', 2);
insertCat.run('娱乐导航', 'entertainment', 'Play', 3);
insertCat.run('实用软件', 'software', 'Download', 4);
insertCat.run('其它相关', 'other', 'Layout', 6);

const cats = db.prepare('SELECT id FROM categories').all();
const sites = db.prepare('SELECT id FROM sites').all();
const updateSite = db.prepare('UPDATE sites SET category_id = ? WHERE id = ?');

const transaction = db.transaction(() => {
   for (let i = 0; i < sites.length; i++) {
      const cat = cats[i % cats.length];
      updateSite.run((cat as any).id, (sites[i] as any).id);
   }
});

transaction();
console.log("Distributed sites across categories");
