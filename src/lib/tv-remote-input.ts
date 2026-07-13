import type { Direction } from "@/sim/mine";

export interface TvRemoteKey {
  key: string;
  keyCode: number;
}

/**
 * Physical Fire TV controls that Silk does not need for cursor navigation.
 * Named keys follow the UI Events key-value standard. Legacy Android codes
 * cover Silk stacks that leave `key` unidentified.
 */
export function tvRemoteDirection({
  key,
  keyCode,
}: TvRemoteKey): Direction | null {
  if (key === "ChannelUp" || keyCode === 166) return "up";
  if (key === "ChannelDown" || keyCode === 167) return "down";
  if (key === "MediaRewind" || keyCode === 227) return "left";
  if (key === "MediaFastForward" || keyCode === 228) return "right";
  return null;
}
