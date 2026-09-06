export interface Category {
  id: number;
  name: string;
  slug: string;
  icon: string | null;
  sort_order: number;
  parent_id: number | null;
}

export interface Site {
  id: number;
  name: string;
  url: string;
  description: string;
  category_id: number;
  tags: string; // JSON string in DB, but array in frontend
  icon_url: string | null;
  local_icon_path: string | null;
  screenshot_path: string | null;
  status: string;
  weight: number;
  is_featured: number; // 0 or 1
  is_hidden: number; // 0 or 1
  source: string | null;
  created_at: string;
  updated_at: string;
  checked_at: string | null;
}

export interface SiteResponse extends Omit<Site, 'tags'> {
  tags: string[]; // Parsed array
  category_name?: string;
  category_slug?: string;
}
