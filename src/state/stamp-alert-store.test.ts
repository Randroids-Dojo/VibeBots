import { beforeEach, describe, expect, it } from "vitest";
import {
  enqueueStampAlertsFromResponse,
  newStampsFromResponse,
  useStampAlertStore,
} from "./stamp-alert-store";

beforeEach(() => {
  useStampAlertStore.setState({ queue: [] });
});

describe("newStampsFromResponse", () => {
  it("reads only well-formed newStamps arrays", () => {
    expect(newStampsFromResponse(null)).toEqual([]);
    expect(newStampsFromResponse("nope")).toEqual([]);
    expect(newStampsFromResponse({})).toEqual([]);
    expect(newStampsFromResponse({ newStamps: "haul-first-sale" })).toEqual([]);
  });

  it("keeps only known achievement ids", () => {
    expect(
      newStampsFromResponse({
        newStamps: [
          "tool-depot-regular",
          "made-up-stamp",
          42,
          null,
          "haul-first-sale",
        ],
      }),
    ).toEqual(["tool-depot-regular", "haul-first-sale"]);
  });
});

describe("stamp alert queue", () => {
  it("queues stamps in order and drops them one at a time", () => {
    const store = useStampAlertStore.getState();
    store.enqueueStampAlerts(["haul-first-sale", "depth-first-chip"]);
    store.enqueueStampAlerts(["survival-rope-save"]);
    expect(useStampAlertStore.getState().queue).toEqual([
      "haul-first-sale",
      "depth-first-chip",
      "survival-rope-save",
    ]);
    useStampAlertStore.getState().shiftStampAlert();
    expect(useStampAlertStore.getState().queue).toEqual([
      "depth-first-chip",
      "survival-rope-save",
    ]);
  });

  it("ignores stamps already waiting, even within one batch", () => {
    const store = useStampAlertStore.getState();
    store.enqueueStampAlerts(["haul-first-sale", "haul-first-sale"]);
    store.enqueueStampAlerts(["haul-first-sale"]);
    expect(useStampAlertStore.getState().queue).toEqual(["haul-first-sale"]);
  });

  it("feeds the queue straight from an award response body", () => {
    enqueueStampAlertsFromResponse({
      balance: 12,
      newStamps: ["tool-better-pick"],
    });
    enqueueStampAlertsFromResponse({ balance: 12 });
    expect(useStampAlertStore.getState().queue).toEqual(["tool-better-pick"]);
  });
});
