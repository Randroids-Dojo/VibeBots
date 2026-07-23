import { describe, expect, it } from "vitest";
import { updateGoldens } from "./harness";

const updating = process.env.VIBEBOTS_UPDATE_GOLDENS === "1";

describe.skipIf(!updating)("golden updater", () => {
  it("updates changed vectors with a reasoned manifest", async () => {
    const reason = process.env.VIBEBOTS_GOLDEN_REASON ?? "";
    const result = await updateGoldens(reason);
    for (const warning of result.warnings) {
      console.warn(`GOLDEN REVIEW WARNING: ${warning}`);
    }
    console.info(
      result.changes.length === 0
        ? "No deterministic golden output changed."
        : `Updated ${result.changes.length} deterministic golden vector(s).`,
    );
    expect(reason.trim()).not.toBe("");
  });
});
