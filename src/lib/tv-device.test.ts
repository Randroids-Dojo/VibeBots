import { describe, expect, it } from "vitest";
import {
  isTvUserAgent,
  resolveTvMode,
  TV_SAFE_FRACTION,
  tvSafeInsets,
} from "./tv-device";

const FIRE_TV_SILK_UA =
  "Mozilla/5.0 (Linux; Android 11; AFTMA475B1) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Silk/146.3.4 like Chrome/146.0.7680.165 Safari/537.36";
const FIRE_TABLET_SILK_UA =
  "Mozilla/5.0 (Linux; Android 4.4.3; KFTHWI Build/KTU84M) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Silk/44.1.54 like Chrome/44.0.2403.63 Safari/537.36";
const DESKTOP_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_TV_UA =
  "Mozilla/5.0 (Linux; Android 12; BRAVIA 4K VH2 Build/SOF1.220107.075) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36";

describe("isTvUserAgent", () => {
  it("recognizes Fire TV Silk by the AFT model code", () => {
    expect(isTvUserAgent(FIRE_TV_SILK_UA)).toBe(true);
  });

  it("does not flag Fire tablets, which also run Silk", () => {
    expect(isTvUserAgent(FIRE_TABLET_SILK_UA)).toBe(false);
  });

  it("does not flag desktop or phone browsers", () => {
    expect(isTvUserAgent(DESKTOP_CHROME_UA)).toBe(false);
    expect(isTvUserAgent(IPHONE_UA)).toBe(false);
  });

  it("recognizes other TV browsers by their UA tokens", () => {
    expect(isTvUserAgent(ANDROID_TV_UA)).toBe(true);
  });

  it("does not false-positive on lowercase aft inside words", () => {
    expect(isTvUserAgent("Mozilla/5.0 (compatible; aftershock/1.0)")).toBe(
      false,
    );
  });
});

describe("resolveTvMode", () => {
  it("uses the user agent when no override exists", () => {
    expect(
      resolveTvMode({ userAgent: FIRE_TV_SILK_UA, search: "", stored: null }),
    ).toEqual({ tvMode: true, persist: null });
    expect(
      resolveTvMode({ userAgent: DESKTOP_CHROME_UA, search: "", stored: null }),
    ).toEqual({ tvMode: false, persist: null });
  });

  it("lets tv=1 force the mode on and persist", () => {
    expect(
      resolveTvMode({
        userAgent: DESKTOP_CHROME_UA,
        search: "?tv=1",
        stored: null,
      }),
    ).toEqual({ tvMode: true, persist: "1" });
  });

  it("lets tv=0 force the mode off even on a Fire TV", () => {
    expect(
      resolveTvMode({
        userAgent: FIRE_TV_SILK_UA,
        search: "?tv=0",
        stored: "1",
      }),
    ).toEqual({ tvMode: false, persist: "0" });
  });

  it("honors a stored override across visits", () => {
    expect(
      resolveTvMode({ userAgent: DESKTOP_CHROME_UA, search: "", stored: "1" }),
    ).toEqual({ tvMode: true, persist: null });
    expect(
      resolveTvMode({ userAgent: FIRE_TV_SILK_UA, search: "", stored: "0" }),
    ).toEqual({ tvMode: false, persist: null });
  });

  it("ignores malformed overrides", () => {
    expect(
      resolveTvMode({
        userAgent: FIRE_TV_SILK_UA,
        search: "?tv=yes",
        stored: "maybe",
      }),
    ).toEqual({ tvMode: true, persist: null });
  });
});

describe("tvSafeInsets", () => {
  it("insets each edge by the safe fraction of the viewport", () => {
    expect(tvSafeInsets(1920, 1080)).toEqual({ x: 96, y: 54 });
    expect(tvSafeInsets(1280, 720)).toEqual({ x: 64, y: 36 });
  });

  it("rounds to whole pixels so the shell frame stays crisp", () => {
    const { x, y } = tvSafeInsets(963, 541);
    expect(x).toBe(Math.round(963 * TV_SAFE_FRACTION));
    expect(y).toBe(Math.round(541 * TV_SAFE_FRACTION));
    expect(Number.isInteger(x)).toBe(true);
    expect(Number.isInteger(y)).toBe(true);
  });
});
