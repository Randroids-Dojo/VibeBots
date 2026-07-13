import { describe, expect, it } from "vitest";
import { tvRemoteDirection } from "./tv-remote-input";

describe("tv remote input", () => {
  it.each([
    ["ChannelUp", 0, "up"],
    ["ChannelDown", 0, "down"],
    ["MediaRewind", 0, "left"],
    ["MediaFastForward", 0, "right"],
  ] as const)("maps the named %s key to %s", (key, keyCode, direction) => {
    expect(tvRemoteDirection({ key, keyCode })).toBe(direction);
  });

  it.each([
    [166, "up"],
    [167, "down"],
    [227, "left"],
    [228, "right"],
  ] as const)("maps legacy keyCode %i to %s", (keyCode, direction) => {
    expect(tvRemoteDirection({ key: "Unidentified", keyCode })).toBe(direction);
  });

  it("does not consume Back, Select, Play/Pause, or ordinary keys", () => {
    expect(tvRemoteDirection({ key: "GoBack", keyCode: 4 })).toBeNull();
    expect(tvRemoteDirection({ key: "Enter", keyCode: 13 })).toBeNull();
    expect(
      tvRemoteDirection({ key: "MediaPlayPause", keyCode: 179 }),
    ).toBeNull();
    expect(tvRemoteDirection({ key: "ArrowLeft", keyCode: 37 })).toBeNull();
  });
});
