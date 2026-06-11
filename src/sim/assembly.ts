import type {
  Collider,
  ImpulseJoint,
  RevoluteImpulseJoint,
  RigidBody,
  World,
} from "@dimforge/rapier3d-deterministic-compat";
import RAPIER from "@dimforge/rapier3d-deterministic-compat";
import { type BotDesign, type Connection, validateDesign } from "./design";
import { PART_CATALOG, type PartDef, type PartShape, type Vec3 } from "./parts";

/**
 * Turns a validated design tree into rigid bodies and joints. Creation
 * order (BFS from the core, children sorted by instance id) is part of the
 * determinism contract; never reorder without bumping SIM_VERSION.
 *
 * Parts attach with identity rotation this slice: a child's world position
 * is parent position + parent connector offset - child connector offset.
 * Oriented attachment (90-degree connector steps) is followup F-006.
 */

const HALF_SQRT2 = Math.sqrt(0.5);

export interface AssembledBot {
  rootIid: string;
  bodies: Map<string, RigidBody>;
  colliders: Map<string, Collider>;
  joints: ImpulseJoint[];
  /** Revolute joints from axle connections, motor-ready (wheels, legs later). */
  axleJoints: RevoluteImpulseJoint[];
  /** The joint attaching each non-root instance to its parent (detach point). */
  jointToParent: Map<string, ImpulseJoint>;
}

function colliderDescFor(
  shape: PartShape,
  density: number,
): RAPIER.ColliderDesc {
  switch (shape.type) {
    case "cuboid":
      return RAPIER.ColliderDesc.cuboid(
        shape.hx,
        shape.hy,
        shape.hz,
      ).setDensity(density);
    case "ball":
      return RAPIER.ColliderDesc.ball(shape.radius).setDensity(density);
    case "cylinder": {
      const desc = RAPIER.ColliderDesc.cylinder(
        shape.halfHeight,
        shape.radius,
      ).setDensity(density);
      // Rapier cylinders stand on local Y; reorient with exact quaternions.
      if (shape.axis === "x") {
        desc.setRotation({ x: 0, y: 0, z: HALF_SQRT2, w: HALF_SQRT2 });
      } else if (shape.axis === "z") {
        desc.setRotation({ x: HALF_SQRT2, y: 0, z: 0, w: HALF_SQRT2 });
      }
      return desc;
    }
  }
}

function connectorOn(part: PartDef, connectorId: string) {
  const connector = part.connectors.find((c) => c.id === connectorId);
  if (!connector)
    throw new Error(`part ${part.id} has no connector "${connectorId}"`);
  return connector;
}

export function assembleBot(
  world: World,
  design: BotDesign,
  origin: Vec3,
  catalog: Record<string, PartDef> = PART_CATALOG,
): AssembledBot {
  const validation = validateDesign(design, catalog);
  if (!validation.ok) {
    throw new Error(
      `invalid design "${design.name}": ${validation.errors.join("; ")}`,
    );
  }

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
    (p) => catalog[p.partId].category === "core",
  )?.iid;
  if (rootIid === undefined) throw new Error("validated design lost its core");

  const bodies = new Map<string, RigidBody>();
  const colliders = new Map<string, Collider>();
  const joints: ImpulseJoint[] = [];
  const axleJoints: RevoluteImpulseJoint[] = [];
  const jointToParent = new Map<string, ImpulseJoint>();
  const positions = new Map<string, Vec3>([[rootIid, origin]]);

  const queue = [rootIid];
  while (queue.length > 0) {
    const iid = queue.shift();
    if (iid === undefined) break;
    const part = partByIid.get(iid);
    const position = positions.get(iid);
    if (!part || !position) throw new Error(`assembly lost instance "${iid}"`);

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(
        position.x,
        position.y,
        position.z,
      ),
    );
    colliders.set(
      iid,
      world.createCollider(colliderDescFor(part.shape, part.density), body),
    );
    bodies.set(iid, body);

    for (const conn of childConnections.get(iid) ?? []) {
      const childPart = partByIid.get(conn.childIid);
      if (!childPart)
        throw new Error(`assembly lost instance "${conn.childIid}"`);
      const parentAnchor = connectorOn(part, conn.parentConnector);
      const childAnchor = connectorOn(childPart, conn.childConnector);
      positions.set(conn.childIid, {
        x: position.x + parentAnchor.position.x - childAnchor.position.x,
        y: position.y + parentAnchor.position.y - childAnchor.position.y,
        z: position.z + parentAnchor.position.z - childAnchor.position.z,
      });
      queue.push(conn.childIid);
    }
  }

  // Joints in connection order, after all bodies exist.
  for (const conn of design.connections) {
    const parentBody = bodies.get(conn.parentIid);
    const childBody = bodies.get(conn.childIid);
    const parentPart = partByIid.get(conn.parentIid);
    const childPart = partByIid.get(conn.childIid);
    if (!parentBody || !childBody || !parentPart || !childPart) {
      throw new Error("assembly lost a connection endpoint");
    }
    const parentAnchor = connectorOn(parentPart, conn.parentConnector);
    const childAnchor = connectorOn(childPart, conn.childConnector);

    if (parentAnchor.kind === "axle") {
      const axis = parentAnchor.axis;
      if (!axis)
        throw new Error(`axle connector ${conn.parentConnector} lacks an axis`);
      const data = RAPIER.JointData.revolute(
        parentAnchor.position,
        childAnchor.position,
        axis,
      );
      const joint = world.createImpulseJoint(data, parentBody, childBody, true);
      joint.setContactsEnabled(false);
      joints.push(joint);
      jointToParent.set(conn.childIid, joint);
      axleJoints.push(joint as RevoluteImpulseJoint);
    } else {
      const identity = { x: 0, y: 0, z: 0, w: 1 };
      const data = RAPIER.JointData.fixed(
        parentAnchor.position,
        identity,
        childAnchor.position,
        identity,
      );
      const joint = world.createImpulseJoint(data, parentBody, childBody, true);
      joint.setContactsEnabled(false);
      joints.push(joint);
      jointToParent.set(conn.childIid, joint);
    }
  }

  return { rootIid, bodies, colliders, joints, axleJoints, jointToParent };
}

/** Drives every axle motor at the given angular velocity (rad/s). */
export function setDriveVelocity(
  bot: AssembledBot,
  velocity: number,
  factor = 50,
): void {
  for (const joint of bot.axleJoints) {
    joint.configureMotorVelocity(velocity, factor);
  }
}
