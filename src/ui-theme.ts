export const UI_THEME_STORAGE_KEY = "uiTheme";
export const UI_THEME_CLASSIC = "classic";
export const UI_THEME_IOS_PROFESSIONAL = "ios-professional";

export type UiTheme = typeof UI_THEME_CLASSIC | typeof UI_THEME_IOS_PROFESSIONAL;
export type ColorMode = "light" | "dark";

type ThemeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type ThemeDocument = Pick<Document, "documentElement">;

let iosProfessionalStylesPromise: Promise<void> | null = null;

export function normalizeUiThemePreference(value: string | null): UiTheme {
  return value === UI_THEME_IOS_PROFESSIONAL ? UI_THEME_IOS_PROFESSIONAL : UI_THEME_CLASSIC;
}

export function readUiThemePreference(storage: ThemeStorage = localStorage): UiTheme {
  const storedTheme = storage.getItem(UI_THEME_STORAGE_KEY);
  const normalizedTheme = normalizeUiThemePreference(storedTheme);

  if (storedTheme && storedTheme !== normalizedTheme) {
    storage.removeItem(UI_THEME_STORAGE_KEY);
  }

  return normalizedTheme;
}

export function saveUiThemePreference(theme: UiTheme, storage: ThemeStorage = localStorage) {
  const normalizedTheme = normalizeUiThemePreference(theme);
  storage.setItem(UI_THEME_STORAGE_KEY, normalizedTheme);
  return normalizedTheme;
}

export function ensureUiThemeStylesLoaded(theme: UiTheme) {
  if (theme !== UI_THEME_IOS_PROFESSIONAL) {
    return Promise.resolve();
  }

  if (!iosProfessionalStylesPromise) {
    iosProfessionalStylesPromise = import("./themes/ios-professional.css")
      .then(() => undefined)
      .catch((error) => {
        iosProfessionalStylesPromise = null;
        throw error;
      });
  }

  return iosProfessionalStylesPromise;
}

export async function applyUiThemePreference(
  theme: UiTheme,
  ownerDocument: ThemeDocument = document,
) {
  const normalizedTheme = normalizeUiThemePreference(theme);
  await ensureUiThemeStylesLoaded(normalizedTheme);
  ownerDocument.documentElement.dataset.uiTheme = normalizedTheme;
  return normalizedTheme;
}

export async function initializeUiThemePreference(
  storage: ThemeStorage = localStorage,
  ownerDocument: ThemeDocument = document,
) {
  const theme = readUiThemePreference(storage);
  await applyUiThemePreference(theme, ownerDocument);
  return theme;
}

export function readColorModePreference(
  storage: Pick<Storage, "getItem"> = localStorage,
  matchMedia: Window["matchMedia"] = window.matchMedia.bind(window),
): ColorMode {
  const storedTheme = storage.getItem("theme");
  if (storedTheme === "dark" || storedTheme === "light") {
    return storedTheme;
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyColorModePreference(
  colorMode: ColorMode,
  ownerDocument: ThemeDocument = document,
) {
  ownerDocument.documentElement.classList.toggle("dark", colorMode === "dark");
  return colorMode;
}

export function saveColorModePreference(
  colorMode: ColorMode,
  storage: Pick<Storage, "setItem"> = localStorage,
  ownerDocument: ThemeDocument = document,
) {
  storage.setItem("theme", colorMode);
  return applyColorModePreference(colorMode, ownerDocument);
}

export function initializeColorModePreference(
  storage: Pick<Storage, "getItem"> = localStorage,
  ownerDocument: ThemeDocument = document,
  matchMedia: Window["matchMedia"] = window.matchMedia.bind(window),
) {
  return applyColorModePreference(readColorModePreference(storage, matchMedia), ownerDocument);
}
