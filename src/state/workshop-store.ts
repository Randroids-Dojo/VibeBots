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
): PlacementSlot[] {
  const iid = nextIid(design, part.id);
  const slots: PlacementSlot[] = [];
  for (const slot of findFreeConnectors(design, part, catalog)) {
    const next: BotDesign = {
      ...design,
      parts: [...design.parts, { iid, partId: part.id }],
      connections: [
        ...design.connections,
        {
          parentIid: slot.parentIid,
          parentConnector: slot.parentConnector,
          childIid: iid,
          childConnector: slot.childConnector,
        },
      ],
    };
    if (validateDesign(next, catalog).ok) {
      slots.push({
        partId: part.id,
        parentIid: slot.parentIid,
        parentConnector: slot.parentConnector,
        childConnector: slot.childConnector,
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
  /** The palette part whose placement ghosts are showing, if any. */
  armedPartId: string | null;
  addPart: (partId: string) => void;
  armPart: (partId: string | null) => void;
  placeAtSlot: (slot: PlacementSlot) => void;
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
  armedPartId: null,

  addPart: (partId) => {
    const { history, design } = get();
    const def = PART_CATALOG[partId];
    if (!def) return;
    const plan = planAddPart(design, def);
    if (!plan) return;
    set({
      ...withDesign(pushHistory(history, plan.next)),
      selectedIid: plan.iid,
    });
  },

  // Arming toggles: tapping the armed part again puts the palette away.
  armPart: (partId) =>
    set((s) => ({
      armedPartId: partId === null || s.armedPartId === partId ? null : partId,
    })),

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
    const next: BotDesign = {
      ...design,
      parts: [...design.parts, { iid, partId: slot.partId }],
      connections: [
        ...design.connections,
        {
          parentIid: slot.parentIid,
          parentConnector: slot.parentConnector,
          childIid: iid,
          childConnector: slot.childConnector,
        },
      ],
    };
    if (!validateDesign(next).ok) return;
    set({
      ...withDesign(pushHistory(history, next)),
      selectedIid: iid,
      armedPartId: null,
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
    // Leaves only: a part with children must lose its subtree first.
    if (design.connections.some((c) => c.parentIid === selectedIid)) return;
    const next: BotDesign = {
      ...design,
      parts: design.parts.filter((p) => p.iid !== selectedIid),
      connections: design.connections.filter((c) => c.childIid !== selectedIid),
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

  select: (iid) => set({ selectedIid: iid }),

  undo: () => {
    const { history } = get();
    if (!canUndo(history)) return;
    set({
      ...withDesign(undoHistory(history)),
      selectedIid: null,
      armedPartId: null,
    });
  },

  redo: () => {
    const { history } = get();
    if (!canRedo(history)) return;
    set({
      ...withDesign(redoHistory(history)),
      selectedIid: null,
      armedPartId: null,
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
      armedPartId: null,
    }),

  reset: () =>
    set({
      ...withDesign(createHistory<BotDesign>(STARTER_DESIGN)),
      selectedIid: null,
      armedPartId: null,
    }),
}));
