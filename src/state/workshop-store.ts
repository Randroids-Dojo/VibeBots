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
import { type BotDesign, type Connection, validateDesign } from "@/sim/design";
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
 * First free parent connector compatible with the part's first connector,
 * scanning parts and connectors in design order (deterministic).
 */
export function findFreeConnector(
  design: BotDesign,
  part: PartDef,
  catalog: Record<string, PartDef> = PART_CATALOG,
): FreeConnector | null {
  const mount = part.connectors[0];
  if (!mount) return null;
  const used = new Set<string>();
  for (const conn of design.connections) {
    used.add(`${conn.parentIid}:${conn.parentConnector}`);
    used.add(`${conn.childIid}:${conn.childConnector}`);
  }
  for (const instance of design.parts) {
    const def = catalog[instance.partId];
    if (!def) continue;
    for (const connector of def.connectors) {
      if (connector.kind !== mount.kind) continue;
      if (used.has(`${instance.iid}:${connector.id}`)) continue;
      return {
        parentIid: instance.iid,
        parentConnector: connector.id,
        childConnector: mount.id,
      };
    }
  }
  return null;
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
  addPart: (partId: string) => void;
  removeSelected: () => void;
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

  addPart: (partId) => {
    const { history, design } = get();
    const def = PART_CATALOG[partId];
    if (!def) return;
    const slot = findFreeConnector(design, def);
    if (!slot) return;
    const iid = nextIid(design, partId);
    const connection: Connection = {
      parentIid: slot.parentIid,
      parentConnector: slot.parentConnector,
      childIid: iid,
      childConnector: slot.childConnector,
    };
    const next: BotDesign = {
      ...design,
      parts: [...design.parts, { iid, partId }],
      connections: [...design.connections, connection],
    };
    if (!validateDesign(next).ok) return;
    set({ ...withDesign(pushHistory(history, next)), selectedIid: iid });
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

  select: (iid) => set({ selectedIid: iid }),

  undo: () => {
    const { history } = get();
    if (!canUndo(history)) return;
    set({ ...withDesign(undoHistory(history)), selectedIid: null });
  },

  redo: () => {
    const { history } = get();
    if (!canRedo(history)) return;
    set({ ...withDesign(redoHistory(history)), selectedIid: null });
  },

  reset: () =>
    set({
      ...withDesign(createHistory<BotDesign>(STARTER_DESIGN)),
      selectedIid: null,
    }),
}));
