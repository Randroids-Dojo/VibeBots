import {
  canRedo,
  canUndo,
  createHistory,
  type EditorHistory,
  pushHistory,
  redoHistory,
  undoHistory,
} from "@randroids-dojo/vibekit";
import { create } from "zustand";
import {
  type BotBehavior,
  type BotDesign,
  type Connection,
  MAX_PART_MERGE_LEVEL,
  NEUTRAL_BEHAVIOR,
  type Orientation,
  partMergeLevel,
  validateDesign,
} from "@/sim/design";
import { PART_CATALOG, type PartDef } from "@/sim/parts";

/**
 * Workshop UI state. The design is the single source of truth (the same
 * structure that fights online); history snapshots whole designs via
 * VibeKit's editor history. Sim state never lives here.
 */

export const STARTER_DESIGN: BotDesign = {
  name: "My Bot",
  parts: [{ iid: "core", partId: "core-cube" }],
  connections: [],
};

/**
 * The non-core catalog in a stable order: the build carousel shows one of
 * these at a time (N1 direct-manipulation build), and prev/next steps
 * through this list. Cores never appear (a design has exactly one, the
 * starter root).
 */
export const CAROUSEL_PART_IDS: string[] = Object.values(PART_CATALOG)
  .filter((p) => p.category !== "core")
  .map((p) => p.id);

// The chassis options for the Build tab core selector (I), in catalog order.
export const CORE_PART_IDS: string[] = Object.values(PART_CATALOG)
  .filter((p) => p.category === "core")
  .map((p) => p.id);

/** The design's current core part id (the root, found by category). */
export function currentCoreId(design: BotDesign): string | null {
  return (
    design.parts.find((p) => PART_CATALOG[p.partId]?.category === "core")
      ?.partId ?? null
  );
}

interface FreeConnector {
  parentIid: string;
  parentConnector: string;
  childConnector: string;
}

/**
 * All free parent connectors compatible with any of the part's
 * connectors, in design order (deterministic). Among matching child
 * connectors, each candidate picks the one placing the part farthest
 * from its parent: anchors are surface points, so the farthest pairing
 * is the outward-facing one (a plate mounted by its 'top' would sink
 * inside the parent; its 'bottom' sits flush outside).
 */
export function findFreeConnectors(
  design: BotDesign,
  part: PartDef,
  catalog: Record<string, PartDef> = PART_CATALOG,
): FreeConnector[] {
  const used = new Set<string>();
  for (const conn of design.connections) {
    used.add(`${conn.parentIid}:${conn.parentConnector}`);
    used.add(`${conn.childIid}:${conn.childConnector}`);
  }
  const candidates: FreeConnector[] = [];
  for (const instance of design.parts) {
    const def = catalog[instance.partId];
    if (!def) continue;
    for (const connector of def.connectors) {
      if (used.has(`${instance.iid}:${connector.id}`)) continue;
      let best: { id: string; dist: number } | null = null;
      for (const mount of part.connectors) {
        if (mount.kind !== connector.kind) continue;
        const dx = connector.position.x - mount.position.x;
        const dy = connector.position.y - mount.position.y;
        const dz = connector.position.z - mount.position.z;
        const dist = dx * dx + dy * dy + dz * dz;
        if (!best || dist > best.dist) best = { id: mount.id, dist };
      }
      if (best) {
        candidates.push({
          parentIid: instance.iid,
          parentConnector: connector.id,
          childConnector: best.id,
        });
      }
    }
  }
  return candidates;
}

/**
 * A concrete place-this-part-here option: the parent connector to mount
 * on, the child connector to mount by, the iid the new part would take,
 * and the whole validated design that results. The workshop renders one
 * ghost per slot and commits the exact connection the player taps.
 */
export interface PlacementSlot {
  partId: string;
  parentIid: string;
  parentConnector: string;
  childConnector: string;
  /** Mount orientation applied at this slot (rigid mounts only; N4). */
  orientation: Orientation;
  iid: string;
  next: BotDesign;
}

/**
 * Every legal placement of the part on the current design: each free
 * connector that yields a design which still validates (overlap and
 * budget rules included). Pure and deterministic (design order), so the
 * ghosts and the slot list agree with what a tap will actually do.
 */
export function validSlotsFor(
  design: BotDesign,
  part: PartDef,
  catalog: Record<string, PartDef> = PART_CATALOG,
  orientation: Orientation = 0,
): PlacementSlot[] {
  const iid = nextIid(design, part.id);
  const slots: PlacementSlot[] = [];
  for (const slot of findFreeConnectors(design, part, catalog)) {
    // Orientation only applies to rigid mounts; axle connections stay
    // unoriented by the validity rule, so a rotated wheel still places.
    const parentPart = design.parts.find((p) => p.iid === slot.parentIid);
    const parentConn = parentPart
      ? catalog[parentPart.partId]?.connectors.find(
          (c) => c.id === slot.parentConnector,
        )
      : undefined;
    const orient: Orientation = parentConn?.kind === "rigid" ? orientation : 0;
    const connection: Connection = {
      parentIid: slot.parentIid,
      parentConnector: slot.parentConnector,
      childIid: iid,
      childConnector: slot.childConnector,
      ...(orient ? { orientation: orient } : {}),
    };
    const next: BotDesign = {
      ...design,
      parts: [...design.parts, { iid, partId: part.id }],
      connections: [...design.connections, connection],
    };
    if (validateDesign(next, catalog).ok) {
      slots.push({
        partId: part.id,
        parentIid: slot.parentIid,
        parentConnector: slot.parentConnector,
        childConnector: slot.childConnector,
        orientation: orient,
        iid,
        next,
      });
    }
  }
  return slots;
}

/**
 * The full add precondition: at least one valid slot exists. The palette
 * gate shares this with the placement flow so the button state never
 * lies about whether a part can go down.
 */
export function planAddPart(
  design: BotDesign,
  part: PartDef,
  catalog: Record<string, PartDef> = PART_CATALOG,
): { next: BotDesign; iid: string } | null {
  const slot = validSlotsFor(design, part, catalog)[0];
  return slot ? { next: slot.next, iid: slot.iid } : null;
}

/** The full rotate precondition; null when no legal quarter-turn exists. */
export function planRotateSelected(
  design: BotDesign,
  selectedIid: string | null,
  catalog: Record<string, PartDef> = PART_CATALOG,
): BotDesign | null {
  if (!selectedIid) return null;
  const index = design.connections.findIndex((c) => c.childIid === selectedIid);
  if (index < 0) return null;
  const conn = design.connections[index];
  const parent = design.parts.find((p) => p.iid === conn.parentIid);
  const parentDef = parent ? catalog[parent.partId] : null;
  const parentConn = parentDef?.connectors.find(
    (c) => c.id === conn.parentConnector,
  );
  // Axle connections cannot be oriented (validity rule).
  if (!parentConn || parentConn.kind === "axle") return null;
  const orientationCycle: Orientation[] = [0, 90, 180, 270];
  const current = (conn.orientation ?? 0) as Orientation;
  // Try successive quarter turns; skip ones the validity rules reject.
  for (let stepCount = 1; stepCount < 4; stepCount++) {
    const orientation =
      orientationCycle[(orientationCycle.indexOf(current) + stepCount) % 4];
    const next: BotDesign = {
      ...design,
      connections: design.connections.map((c, i) =>
        i === index ? { ...c, orientation } : c,
      ),
    };
    if (validateDesign(next, catalog).ok) return next;
  }
  return null;
}

/**
 * A part plus every part hung off it, transitively. Removing a part in a
 * stack takes its whole subtree so no child is left floating without its
 * parent.
 */
export function subtreeIids(design: BotDesign, rootIid: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const conn of design.connections) {
    const list = childrenOf.get(conn.parentIid);
    if (list) list.push(conn.childIid);
    else childrenOf.set(conn.parentIid, [conn.childIid]);
  }
  const removed = new Set<string>();
  const stack = [rootIid];
  while (stack.length > 0) {
    const iid = stack.pop();
    if (iid === undefined || removed.has(iid)) continue;
    removed.add(iid);
    for (const child of childrenOf.get(iid) ?? []) stack.push(child);
  }
  return removed;
}

export function planMergeSelectedPart(
  design: BotDesign,
  selectedIid: string | null,
  catalog: Record<string, PartDef> = PART_CATALOG,
): BotDesign | null {
  if (!selectedIid) return null;
  const selected = design.parts.find((p) => p.iid === selectedIid);
  if (!selected) return null;
  const def = catalog[selected.partId];
  if (!def || def.category === "core") return null;
  const currentLevel = partMergeLevel(selected);
  if (currentLevel >= MAX_PART_MERGE_LEVEL) return null;
  const next: BotDesign = {
    ...design,
    parts: design.parts.map((part) =>
      part.iid === selectedIid
        ? { ...part, mergeLevel: currentLevel + 1 }
        : part,
    ),
  };
  return validateDesign(next, catalog).ok ? next : null;
}

function nextIid(design: BotDesign, partId: string): string {
  let n = 1;
  while (design.parts.some((p) => p.iid === `${partId}-${n}`)) n += 1;
  return `${partId}-${n}`;
}

export interface WorkshopState {
  history: EditorHistory<BotDesign>;
  design: BotDesign;
  selectedIid: string | null;
  /** The part shown in the build carousel (N1); prev/next steps it. */
  browsePartId: string;
  /** Mount orientation the carousel part will place with (N4, rigid only). */
  browseOrientation: Orientation;
  /** True while the Build tab is up, so the canvas shows the hero part. */
  buildActive: boolean;
  /** True when the carousel part is owned-out, so the hero renders grayed. */
  browseDimmed: boolean;
  /**
   * True when the player tapped the hero part to reveal its stats in the
   * bottom inspector (G). Mutually exclusive with a selected placed part:
   * only one bottom panel shows at a time.
   */
  browseStatsOpen: boolean;
  /**
   * While a drag hovers a merge twin, the level the drop would produce, so
   * the panel can show a "release to merge" banner (Slice B). Null when the
   * drag is over an empty slot or not dragging.
   */
  mergePreviewLevel: number | null;
  addPart: (partId: string) => void;
  browseBy: (dir: number) => void;
  rotateBrowse: () => void;
  setBuildActive: (active: boolean) => void;
  setBrowseDimmed: (dimmed: boolean) => void;
  /** Tap the hero part: reveal/hide its stats, clearing any placed selection. */
  toggleBrowseStats: () => void;
  /** Swap the chassis: reset to a fresh bot on the given core (I). */
  setCore: (coreId: string) => void;
  setMergePreviewLevel: (level: number | null) => void;
  placeAtSlot: (slot: PlacementSlot) => void;
  mergePart: (iid: string) => void;
  removeSelected: () => void;
  mergeSelectedPart: () => void;
  rotateSelected: () => void;
  setName: (name: string) => void;
  setBehavior: (patch: Partial<BotBehavior>) => void;
  loadDesign: (design: BotDesign) => void;
  select: (iid: string | null) => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
}

function withDesign(history: EditorHistory<BotDesign>) {
  return { history, design: history.present };
}

export const useWorkshopStore = create<WorkshopState>((set, get) => ({
  ...withDesign(createHistory<BotDesign>(STARTER_DESIGN)),
  selectedIid: null,
  browsePartId: CAROUSEL_PART_IDS[0],
  browseOrientation: 0,
  buildActive: true,
  browseDimmed: false,
  browseStatsOpen: false,
  mergePreviewLevel: null,

  addPart: (partId) => {
    const { history, design } = get();
    const def = PART_CATALOG[partId];
    if (!def) return;
    const plan = planAddPart(design, def);
    if (!plan) return;
    set({
      ...withDesign(pushHistory(history, plan.next)),
      selectedIid: plan.iid,
      browseStatsOpen: false,
    });
  },

  // Step the build carousel to the next/previous non-core part, wrapping
  // at the ends so the list is a loop (N1). A fresh part starts unrotated,
  // and cycling clears any selected placed part so viewing a new part
  // starts from a clean bench (user feedback).
  browseBy: (dir) =>
    set((s) => {
      const list = CAROUSEL_PART_IDS;
      const index = list.indexOf(s.browsePartId);
      const next = (index + dir + list.length) % list.length;
      return {
        browsePartId: list[next],
        browseOrientation: 0,
        selectedIid: null,
      };
    }),

  // Cycle the carousel part's mount orientation a quarter turn (N4). Only
  // rigid mounts honour it; axle mounts ignore it by the validity rule.
  rotateBrowse: () =>
    set((s) => ({
      browseOrientation: ((s.browseOrientation + 90) % 360) as Orientation,
    })),

  setBuildActive: (active) => set({ buildActive: active }),

  setBrowseDimmed: (dimmed) => set({ browseDimmed: dimmed }),

  toggleBrowseStats: () =>
    set((s) => ({ browseStatsOpen: !s.browseStatsOpen, selectedIid: null })),

  // Swap the chassis (I). Connector layouts differ per core, so this resets
  // to a fresh bot rooted at the chosen core, keeping the bot's name and
  // temperament. Undoable (pushes history), so a mistaken swap is one Undo
  // away; no confirm modal (Rule 7, one consistent flow).
  setCore: (coreId) => {
    const { history, design } = get();
    if (PART_CATALOG[coreId]?.category !== "core") return;
    if (currentCoreId(design) === coreId) return;
    const next: BotDesign = {
      name: design.name,
      parts: [{ iid: "core", partId: coreId }],
      connections: [],
      ...(design.behavior ? { behavior: design.behavior } : {}),
    };
    set({
      ...withDesign(pushHistory(history, next)),
      selectedIid: null,
      browseStatsOpen: false,
    });
  },

  setMergePreviewLevel: (level) => set({ mergePreviewLevel: level }),

  // Commit the exact connection the tapped ghost (or slot button) named,
  // rebuilt against the live design so it cannot land a stale placement.
  placeAtSlot: (slot) => {
    const { history, design } = get();
    const def = PART_CATALOG[slot.partId];
    if (!def) return;
    const parentUsed = design.connections.some(
      (c) =>
        `${c.parentIid}:${c.parentConnector}` ===
        `${slot.parentIid}:${slot.parentConnector}`,
    );
    if (parentUsed) return;
    const iid = nextIid(design, slot.partId);
    const connection: Connection = {
      parentIid: slot.parentIid,
      parentConnector: slot.parentConnector,
      childIid: iid,
      childConnector: slot.childConnector,
      ...(slot.orientation ? { orientation: slot.orientation } : {}),
    };
    const next: BotDesign = {
      ...design,
      parts: [...design.parts, { iid, partId: slot.partId }],
      connections: [...design.connections, connection],
    };
    if (!validateDesign(next).ok) return;
    set({
      ...withDesign(pushHistory(history, next)),
      selectedIid: iid,
      browseStatsOpen: false,
    });
  },

  // Merge-as-placement (W4): while armed, tapping an already-placed part
  // of the same kind spends the copy on a level-up instead of a new part.
  mergePart: (iid) => {
    const { history, design } = get();
    const next = planMergeSelectedPart(design, iid);
    if (!next) return;
    set({
      ...withDesign(pushHistory(history, next)),
      selectedIid: iid,
      browseStatsOpen: false,
    });
  },

  removeSelected: () => {
    const { history, design, selectedIid } = get();
    if (!selectedIid) return;
    const def =
      PART_CATALOG[
        design.parts.find((p) => p.iid === selectedIid)?.partId ?? ""
      ];
    if (!def || def.category === "core") return;
    // Removing a part in a stack takes its whole subtree with it, so no child
    // is left floating. Every removed part frees its inventory automatically:
    // the available count is owned minus what the design uses, so dropping
    // the parts (and undo restoring them) refunds without a server call.
    const removed = subtreeIids(design, selectedIid);
    const next: BotDesign = {
      ...design,
      parts: design.parts.filter((p) => !removed.has(p.iid)),
      connections: design.connections.filter(
        (c) => !removed.has(c.childIid) && !removed.has(c.parentIid),
      ),
    };
    set({ ...withDesign(pushHistory(history, next)), selectedIid: null });
  },

  mergeSelectedPart: () => {
    const { history, design, selectedIid } = get();
    const next = planMergeSelectedPart(design, selectedIid);
    if (!next) return;
    set({ ...withDesign(pushHistory(history, next)) });
  },

  rotateSelected: () => {
    const { history, design, selectedIid } = get();
    const next = planRotateSelected(design, selectedIid);
    if (!next) return;
    set({ ...withDesign(pushHistory(history, next)) });
  },

  select: (iid) => set({ selectedIid: iid, browseStatsOpen: false }),

  undo: () => {
    const { history } = get();
    if (!canUndo(history)) return;
    set({
      ...withDesign(undoHistory(history)),
      selectedIid: null,
    });
  },

  redo: () => {
    const { history } = get();
    if (!canRedo(history)) return;
    set({
      ...withDesign(redoHistory(history)),
      selectedIid: null,
    });
  },

  setName: (name) => {
    const { history, design } = get();
    const trimmed = name.slice(0, 60);
    if (!trimmed || trimmed === design.name) return;
    set({ ...withDesign(pushHistory(history, { ...design, name: trimmed })) });
  },

  setBehavior: (patch) => {
    const { history, design } = get();
    const behavior: BotBehavior = {
      ...NEUTRAL_BEHAVIOR,
      ...design.behavior,
      ...patch,
    };
    set({ ...withDesign(pushHistory(history, { ...design, behavior })) });
  },

  loadDesign: (design) =>
    set({
      ...withDesign(createHistory<BotDesign>(design)),
      selectedIid: null,
      browseStatsOpen: false,
    }),

  reset: () =>
    set({
      ...withDesign(createHistory<BotDesign>(STARTER_DESIGN)),
      selectedIid: null,
      browsePartId: CAROUSEL_PART_IDS[0],
      browseOrientation: 0,
      browseDimmed: false,
      browseStatsOpen: false,
    }),
}));
