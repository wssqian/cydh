import db from './server/db.js';

const res = db.prepare(`
   DELETE FROM sites 
   WHERE name LIKE '%ACG盒子%' 
      OR name LIKE '%ACGBox%' 
      OR name LIKE '%ACG聚合%'
      OR description LIKE '%ACG盒子%'
`).run();

console.log(`Cleaned up ${res.changes} items related to ACG Box from the local database.`);
