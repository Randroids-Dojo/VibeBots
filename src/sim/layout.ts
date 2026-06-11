import type { BotDesign, Connection } from "./design";
import { PART_CATALOG, type PartDef, type Vec3 } from "./parts";

/**
 * Pure part placement for a design tree: BFS from the core with children
 * sorted by instance id, child position = parent position + parent
 * connector offset - child connector offset (identity rotations, F-006).
 * Assembly and the workshop preview share this so what you build is what
 * fights; the traversal order is part of the determinism contract.
 */
export function computeLayout(
  design: BotDesign,
  catalog: Record<string, PartDef> = PART_CATALOG,
  origin: Vec3 = { x: 0, y: 0, z: 0 },
): Map<string, Vec3> {
  const partByIid = new Map(
    design.parts.map((p) => [p.iid, catalog[p.partId]]),
  );
  const childConnections = new Map<string, Connection[]>();
  for (const conn of design.connections) {
    const list = childConnections.get(conn.parentIid) ?? [];
    list.push(conn);
    childConnections.set(conn.parentIid, list);
  }
  for (const list of childConnections.values()) {
    list.sort((a, b) =>
      a.childIid < b.childIid ? -1 : a.childIid > b.childIid ? 1 : 0,
    );
  }

  const rootIid = design.parts.find(
    (p) => catalog[p.partId]?.category === "core",
  )?.iid;
  const positions = new Map<string, Vec3>();
  if (rootIid === undefined) return positions;
  positions.set(rootIid, { ...origin });

  const queue = [rootIid];
  while (queue.length > 0) {
    const iid = queue.shift();
    if (iid === undefined) break;
    const part = partByIid.get(iid);
    const position = positions.get(iid);
    if (!part || !position) continue;
    for (const conn of childConnections.get(iid) ?? []) {
      const childPart = partByIid.get(conn.childIid);
      const parentAnchor = part.connectors.find(
        (c) => c.id === conn.parentConnector,
      );
      const childAnchor = childPart?.connectors.find(
        (c) => c.id === conn.childConnector,
      );
      if (!parentAnchor || !childAnchor) continue;
      positions.set(conn.childIid, {
        x: position.x + parentAnchor.position.x - childAnchor.position.x,
        y: position.y + parentAnchor.position.y - childAnchor.position.y,
        z: position.z + parentAnchor.position.z - childAnchor.position.z,
      });
      queue.push(conn.childIid);
    }
  }
  return positions;
}
