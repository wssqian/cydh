import type express from "express";

export type TrustedProxySetting = false | "loopback" | number;

export function resolveTrustedProxySetting(value = process.env.TRUST_PROXY_HOPS): TrustedProxySetting {
  const requestedSetting = value?.trim() || "loopback";
  if (requestedSetting === "loopback") {
    return "loopback";
  }
  if (requestedSetting === "0") {
    return false;
  }

  const hops = Number(requestedSetting);
  if (!Number.isInteger(hops) || hops < 1 || hops > 3) {
    throw new Error("TRUST_PROXY_HOPS must be loopback or an integer from 0 through 3.");
  }
  return hops;
}

export function configureTrustedProxy(app: express.Express) {
  const trustedProxy = resolveTrustedProxySetting();
  if (trustedProxy !== false) {
    app.set("trust proxy", trustedProxy);
  }
}
