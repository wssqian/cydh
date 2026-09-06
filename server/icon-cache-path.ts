import path from 'node:path';

export function resolveIconCacheDirectory(dataDirectory = process.env.NAV_DATA_DIR
  ? path.resolve(process.env.NAV_DATA_DIR)
  : path.join(process.cwd(), 'data')) {
  return path.join(dataDirectory, 'icons');
}
