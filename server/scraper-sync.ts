import type Database from 'better-sqlite3';
import type { ScrapedCategory } from './scraper-source.js';

const categoryIcons: Record<string, string> = {
  次元美图: 'Image',
  在线动漫: 'PlaySquare',
  动漫下载: 'DownloadCloud',
  在线漫画: 'BookOpen',
  日轻小说: 'BookText',
  ACG资源: 'PackageOpen',
  ACG游戏: 'Gamepad2',
  ACG社区: 'Users',
  ASMR: 'Headphones',
  ACG网盘: 'HardDrive',
  磁力资源: 'Magnet',
  在线本子: 'Flame',
  视频平台: 'Video',
  在线影视: 'Film',
  在线音乐: 'Music',
  电脑软件: 'Monitor',
  手机软件: 'Smartphone',
  浏览器插件: 'Puzzle',
  在线工具: 'Wrench',
  AI工具: 'Bot',
  'AI 网站': 'Bot',
  网址归档: 'Archive',
};

const categorySlugs: Record<string, string> = {
  次元美图: 'art',
  在线动漫: 'anime-online',
  动漫下载: 'anime-download',
  在线漫画: 'manga',
  日轻小说: 'light-novel',
  ACG资源: 'acg-resources',
  ACG游戏: 'acg-games',
  ACG社区: 'acg-community',
  ASMR: 'asmr',
  ACG网盘: 'acg-drives',
  磁力资源: 'magnet',
  在线本子: 'doujin',
  视频平台: 'video-platforms',
  在线影视: 'movies',
  影视导航: 'movie-navigation',
  影视下载: 'movie-downloads',
  在线音乐: 'music',
  音乐下载: 'music-downloads',
  游戏平台: 'game-platforms',
  游戏工具: 'game-tools',
  游戏下载: 'game-downloads',
  电脑软件: 'pc-soft',
  手机软件: 'mobile-soft',
  浏览器插件: 'plugins',
  在线工具: 'online-tools',
  站长工具: 'webmaster-tools',
  AI工具: 'ai-tools',
  'AI 网站': 'ai-websites',
  网址归档: 'archive',
};

const internalCollectionLogoUrl = '/site-logo.png';
const scrapedCategorySlugs = new Set(Object.values(categorySlugs));

function categorySlug(name: string) {
  return categorySlugs[name] || `section-${Buffer.from(name, 'utf8').toString('base64url')}`;
}

function isGeneratedCategorySlug(slug: string) {
  return scrapedCategorySlugs.has(slug) || slug.startsWith('section-');
}

function isCollectionUrlForSource(url: string, sourceUrl: string) {
  try {
    const candidate = new URL(url);
    const source = new URL(sourceUrl);
    return candidate.origin === source.origin && candidate.pathname.startsWith('/q/');
  } catch {
    return false;
  }
}

export function syncScrapedCategories(database: Database.Database, categories: ScrapedCategory[]) {
  const latestCollectionUrls = new Set<string>();
  const latestInternalCardUrls = new Set<string>();
  const successfulSourceUrls = new Set<string>();

  categories.forEach((category) => {
    successfulSourceUrls.add(category.sourceUrl);
    const slug = categorySlug(category.name);
    category.resources.forEach((resource) => {
      if (resource.collectionUrl) {
        latestCollectionUrls.add(resource.collectionUrl);
        latestInternalCardUrls.add(`/category/${slug}`);
      }
    });
  });

  const upsertCategory = database.prepare(`
    INSERT INTO categories (name, slug, icon, sort_order)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      icon = excluded.icon,
      sort_order = excluded.sort_order
  `);
  const getCategoryByName = database.prepare('SELECT id, slug FROM categories WHERE name = ?');
  const getCategoryId = database.prepare('SELECT id FROM categories WHERE slug = ?');
  const updateCategory = database.prepare('UPDATE categories SET icon = ?, sort_order = ? WHERE id = ?');
  const deleteExternalCollectionSite = database.prepare('DELETE FROM sites WHERE url = ?');
  const deleteSiteById = database.prepare('DELETE FROM sites WHERE id = ?');
  const deleteCategoryById = database.prepare('DELETE FROM categories WHERE id = ?');
  const upsertSite = database.prepare(`
    INSERT INTO sites (name, url, description, category_id, tags, icon_url, local_icon_path, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      category_id = excluded.category_id,
      icon_url = COALESCE(sites.icon_url, excluded.icon_url),
      local_icon_path = COALESCE(sites.local_icon_path, excluded.local_icon_path),
      source = excluded.source,
      updated_at = CURRENT_TIMESTAMP
  `);

  let processed = 0;
  let deletedExternalCollections = 0;
  let deletedInternalCards = 0;
  let deletedCategories = 0;
  const sync = database.transaction((sections: ScrapedCategory[]) => {
    sections.forEach((category, index) => {
      const slug = categorySlug(category.name);
      const icon = categoryIcons[category.name] || 'LayoutTemplate';
      const existingCategory = getCategoryByName.get(category.name) as { id: number; slug: string } | undefined;
      let categoryId: number;
      if (existingCategory) {
        updateCategory.run(icon, index + 1, existingCategory.id);
        categoryId = existingCategory.id;
      } else {
        upsertCategory.run(category.name, slug, icon, index + 1);
        categoryId = (getCategoryId.get(slug) as { id: number }).id;
      }

      category.resources.forEach((resource) => {
        const siteUrl = resource.collectionUrl ? `/category/${slug}` : resource.url;
        if (resource.collectionUrl) {
          deletedExternalCollections += deleteExternalCollectionSite.run(resource.collectionUrl).changes;
        }

        upsertSite.run(
          resource.title,
          siteUrl,
          resource.desc || resource.title,
          categoryId,
          JSON.stringify([]),
          resource.collectionUrl ? internalCollectionLogoUrl : resource.iconUrl || null,
          resource.collectionUrl ? null : resource.localIconPath || null,
          resource.sourceUrl || category.sourceUrl,
        );
        processed += 1;
      });
    });

    const sourceUrls = [...successfulSourceUrls];
    if (sourceUrls.length > 0) {
      const sourcePlaceholders = sourceUrls.map(() => '?').join(', ');
      const staleInternalCards = database.prepare(`
        SELECT id, url
        FROM sites
        WHERE source IN (${sourcePlaceholders})
          AND url LIKE '/category/%'
      `).all(...sourceUrls) as Array<{ id: number; url: string }>;

      staleInternalCards.forEach((site) => {
        if (!latestInternalCardUrls.has(site.url)) {
          deletedInternalCards += deleteSiteById.run(site.id).changes;
        }
      });

      const sourcedSites = database.prepare(`
        SELECT id, url, source
        FROM sites
        WHERE source IN (${sourcePlaceholders})
      `).all(...sourceUrls) as Array<{ id: number; url: string; source: string }>;

      sourcedSites.forEach((site) => {
        if (
          isCollectionUrlForSource(site.url, site.source)
          && !latestCollectionUrls.has(site.url)
        ) {
          deletedExternalCollections += deleteSiteById.run(site.id).changes;
        }
      });
    }

    const emptyCategories = database.prepare(`
      SELECT categories.id, categories.slug
      FROM categories
      LEFT JOIN sites ON sites.category_id = categories.id
      WHERE sites.id IS NULL
    `).all() as Array<{ id: number; slug: string }>;

    emptyCategories.forEach((category) => {
      if (isGeneratedCategorySlug(category.slug)) {
        deletedCategories += deleteCategoryById.run(category.id).changes;
      }
    });
  });

  sync(categories);
  return {
    processed,
    categories: categories.length,
    deletedExternalCollections,
    deletedInternalCards,
    deletedCategories,
  };
}
