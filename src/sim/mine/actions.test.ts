import { describe, expect, it } from "vitest";
import {
  collectAction,
  dropOreAction,
  isMineAction,
  parseCollectAction,
  parseDropOreAction,
  renameBeaconAction,
} from "./actions";
import { applyAction } from "./replay";
import { createMine } from "./world";

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
    expect(parseDropOreAction("drop:coal:2:extra")).toBeNull();
    expect(isMineAction("drop:coal:2:extra")).toBe(false);
    expect(isMineAction(action)).toBe(true);
  });

  it("rejects extra-delimiter ore drops before replay execution", () => {
    const state = createMine(42);
    state.miner.row = 1;
    state.miner.carried.coal = 2;

    expect(applyAction(state, "drop:coal:2:extra" as never)).toEqual({
      ok: false,
      reason: "blocked",
    });
    expect(state.miner.carried.coal).toBe(2);
  });

  it("normalizes encoded beacon rename labels", () => {
    const action = renameBeaconAction({ col: 4, row: 12 }, "  Deep   camp  ");

    expect(action).toBe("rename-beacon:4,12,Deep%20camp");
    expect(isMineAction(action)).toBe(true);
  });
});
