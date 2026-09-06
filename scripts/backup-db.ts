import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

function resolveSourcePath() {
  const dataPath = process.env.NAV_DATA_DIR
    ? path.resolve(process.env.NAV_DATA_DIR)
    : path.join(process.cwd(), 'data');
  return path.join(dataPath, 'nav.db');
}

function defaultBackupPath() {
  const timestamp = new Date().toISOString().replace(/\D/g, '');
  return path.join(process.cwd(), 'backups', `nav-${timestamp}.db`);
}

async function createBackup() {
  const sourcePath = resolveSourcePath();
  const outputPath = path.resolve(process.argv[2] || defaultBackupPath());

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Database not found: ${sourcePath}`);
  }

  if (sourcePath === outputPath) {
    throw new Error('Backup output path must differ from the live database path.');
  }

  if (fs.existsSync(outputPath)) {
    throw new Error(`Backup output already exists: ${outputPath}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const sourceDb = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    const result = sourceDb.pragma('quick_check', { simple: true });
    if (result !== 'ok') {
      throw new Error(`Source database failed quick_check: ${String(result)}`);
    }
    await sourceDb.backup(outputPath);
  } finally {
    sourceDb.close();
  }

  const backupDb = new Database(outputPath, { readonly: true, fileMustExist: true });
  try {
    const result = backupDb.pragma('quick_check', { simple: true });
    if (result !== 'ok') {
      throw new Error(`Backup database failed quick_check: ${String(result)}`);
    }
  } finally {
    backupDb.close();
  }

  console.log(`Portable database backup created: ${outputPath}`);
}

createBackup().catch((error) => {
  console.error(`[Database Backup] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
