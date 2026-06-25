import { describe, expect, it } from "vitest";
import {
  collectAction,
  dropOreAction,
  isMineAction,
  parseCollectAction,
  parseDropOreAction,
  renameBeaconAction,
} from "./actions";

describe("mine action tokens", () => {
  it("round-trips sorted collect targets", () => {
    const action = collectAction([
      { type: "plank", col: 2, row: 4 },
      { type: "ladder", col: 1, row: 4 },
      { type: "beacon", col: 1, row: 3 },
    ]);

    expect(action).toBe("collect:beacon:1,3;ladder:1,4;plank:2,4");
    expect(parseCollectAction(action)).toEqual([
      { type: "beacon", col: 1, row: 3 },
      { type: "ladder", col: 1, row: 4 },
      { type: "plank", col: 2, row: 4 },
    ]);
    expect(isMineAction(action)).toBe(true);
  });

  it("validates ore drop tokens against the authored ore catalog", () => {
    const action = dropOreAction({ coal: 2, diamond: 1 });

    expect(action).toBe("drop:coal:2;diamond:1");
    expect(parseDropOreAction(action)).toEqual({ coal: 2, diamond: 1 });
    expect(parseDropOreAction("drop:not-real:2")).toBeNull();
    expect(isMineAction(action)).toBe(true);
  });

  it("normalizes encoded beacon rename labels", () => {
    const action = renameBeaconAction({ col: 4, row: 12 }, "  Deep   camp  ");

    expect(action).toBe("rename-beacon:4,12,Deep%20camp");
    expect(isMineAction(action)).toBe(true);
  });
});
