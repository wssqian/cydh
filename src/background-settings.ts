export const BACKGROUND_STORAGE_KEY = "backgroundUrl";
export const DEFAULT_BACKGROUND_URL = "https://api.imlcd.cn/bg/gq.php";
export const LEGACY_PROXY_BACKGROUND_PATH = "/api/background/daily";
const BACKGROUND_IMAGE_ID = "client-background-image";

type BackgroundStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function normalizeBackgroundPreference(value: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed === LEGACY_PROXY_BACKGROUND_PATH) {
    return DEFAULT_BACKGROUND_URL;
  }
  return trimmed;
}

export function readBackgroundPreference(storage: BackgroundStorage = localStorage) {
  const storedBackground = storage.getItem(BACKGROUND_STORAGE_KEY);
  const normalizedBackground = normalizeBackgroundPreference(storedBackground);

  if (!storedBackground) {
    return DEFAULT_BACKGROUND_URL;
  }
  if (!normalizedBackground) {
    storage.removeItem(BACKGROUND_STORAGE_KEY);
    return DEFAULT_BACKGROUND_URL;
  }
  if (normalizedBackground !== storedBackground) {
    storage.setItem(BACKGROUND_STORAGE_KEY, normalizedBackground);
  }
  return normalizedBackground;
}

export function saveBackgroundPreference(value: string, storage: BackgroundStorage = localStorage) {
  const normalizedBackground = normalizeBackgroundPreference(value);
  if (!normalizedBackground) {
    return null;
  }
  storage.setItem(BACKGROUND_STORAGE_KEY, normalizedBackground);
  return normalizedBackground;
}

export function resetBackgroundPreference(storage: BackgroundStorage = localStorage) {
  storage.removeItem(BACKGROUND_STORAGE_KEY);
  return DEFAULT_BACKGROUND_URL;
}

export function resolveBackgroundRequestUrl(backgroundUrl: string, refreshToken = Date.now()) {
  if (backgroundUrl !== DEFAULT_BACKGROUND_URL) {
    return backgroundUrl;
  }
  const separator = backgroundUrl.includes("?") ? "&" : "?";
  return `${backgroundUrl}${separator}_refresh=${refreshToken}`;
}

export function applyBackgroundPreference(
  backgroundUrl: string,
  ownerDocument: Document = document,
) {
  ownerDocument.body.style.backgroundImage = "none";

  let backgroundImage = ownerDocument.getElementById(BACKGROUND_IMAGE_ID) as HTMLImageElement | null;
  if (!backgroundImage) {
    backgroundImage = ownerDocument.createElement("img");
    backgroundImage.id = BACKGROUND_IMAGE_ID;
    backgroundImage.className = "client-background-image";
    backgroundImage.alt = "";
    backgroundImage.setAttribute("aria-hidden", "true");
    backgroundImage.decoding = "async";
    ownerDocument.body.prepend(backgroundImage);
  }

  Object.assign(backgroundImage.style, {
    position: "fixed",
    inset: "0px",
    zIndex: "0",
    width: "100vw",
    height: "100vh",
    objectFit: "cover",
    objectPosition: "center",
    pointerEvents: "none",
    userSelect: "none",
  });
  backgroundImage.referrerPolicy = "no-referrer";
  backgroundImage.src = resolveBackgroundRequestUrl(backgroundUrl);
}

export function initializeBackgroundPreference(
  storage: BackgroundStorage = localStorage,
  ownerDocument: Document = document,
) {
  const backgroundUrl = readBackgroundPreference(storage);
  applyBackgroundPreference(backgroundUrl, ownerDocument);
  return backgroundUrl;
}
