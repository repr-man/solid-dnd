import {
  createContext,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  getOwner,
  isDisposed,
  runWithOwner,
  merge,
  untrack,
  useContext,
} from "solid-js";
import { createStore } from "solid-js";
import type { ParentComponent, ParentProps, Store } from "solid-js";

import { CollisionDetector, mostIntersecting } from "./collision";
import {
  layoutsAreEqual,
  elementLayout,
  Layout,
  Transform,
  noopTransform,
  transformLayout,
  transformsAreEqual,
} from "./layout";

type Id = string | number;

interface Coordinates {
  x: number;
  y: number;
}

type SensorActivator<K extends keyof HTMLElementEventMap> = (
  event: HTMLElementEventMap[K],
  draggableId: Id
) => void;

interface Sensor {
  id: Id;
  activators: { [K in keyof HTMLElementEventMap]?: SensorActivator<K> };
  coordinates: {
    origin: Coordinates;
    current: Coordinates;
    get delta(): Coordinates;
  };
}

type TransformerCallback = (transform: Transform) => Transform;

interface Transformer {
  id: Id;
  order: number;
  callback: TransformerCallback;
}

interface Item {
  id: Id;
  node: HTMLElement;
  layout: Layout;
  data: Record<string, any>;
  transformers: Record<Id, Transformer>;
  get transform(): Transform;
  get transformed(): Layout;
  _pendingCleanup?: boolean;
}

interface Draggable extends Item {}

interface Droppable extends Item {}

// Initial transformers are an internal registration detail. The public
// addDroppable action continues to accept the ordinary droppable input.
type DroppableRegistration = Omit<
  Droppable,
  "transform" | "transformed" | "transformers"
> & { transformers?: Record<Id, Transformer> };

interface Overlay extends Item {}

type DragEvent = {
  draggable: Draggable;
  droppable?: Droppable | null;
  overlay?: Overlay | null;
};

interface DragDropState {
  draggables: Record<Id, Draggable>;
  droppables: Record<Id, Droppable>;
  sensors: Record<Id, Sensor>;
  active: {
    draggableId: Id | null;
    draggable: Draggable | null;
    droppableId: Id | null;
    droppable: Droppable | null;
    sensorId: Id | null;
    sensor: Sensor | null;
    overlay: Overlay | null;
  };
}

interface DragDropActions {
  addTransformer(
    type: "draggables" | "droppables",
    id: Id,
    transformer: Transformer
  ): void;
  removeTransformer(
    type: "draggables" | "droppables",
    id: Id,
    transformerId: Id
  ): void;
  addDraggable(
    draggable: Omit<Draggable, "transform" | "transformed" | "transformers">
  ): void;
  removeDraggable(id: Id): void;
  addDroppable(
    droppable: Omit<Droppable, "transform" | "transformed" | "transformers">
  ): void;
  removeDroppable(id: Id): void;
  addSensor(sensor: Omit<Sensor, "coordinates">): void;
  removeSensor(id: Id): void;
  setOverlay(overlay: Pick<Overlay, "node" | "layout">): void;
  clearOverlay(): void;
  recomputeLayouts(): boolean;
  detectCollisions(): void;
  draggableActivators(draggableId: Id, asHandlers?: boolean): Listeners;
  sensorStart(id: Id, coordinates: Coordinates): void;
  sensorMove(coordinates: Coordinates): void;
  sensorEnd(): void;
  dragStart(draggableId: Id): void;
  dragEnd(): void;
  onDragStart(handler: DragEventHandler): void;
  onDragMove(handler: DragEventHandler): void;
  onDragOver(handler: DragEventHandler): void;
  onDragEnd(handler: DragEventHandler): void;
}

interface DragDropContextProps {
  onDragStart?: DragEventHandler;
  onDragMove?: DragEventHandler;
  onDragOver?: DragEventHandler;
  onDragEnd?: DragEventHandler;
  collisionDetector?: CollisionDetector;
}

type DragDropContext = [Store<DragDropState>, DragDropActions];

interface SensorRegistration {
  isCurrent(): boolean;
  isActive(): boolean;
  end(): void;
  dispose(): void;
}

// Pointer sensors retain their registration generation without changing the
// public addSensor/removeSensor actions.
// A stable symbol keeps the private registrar available across hot reloads.
const sensorRegistrar = Symbol.for("@thisbeyond/solid-dnd.registerSensor");
interface SensorActions extends DragDropActions {
  [sensorRegistrar](sensor: Omit<Sensor, "coordinates">): SensorRegistration;
}

const registerSensorWithCleanup = (
  actions: DragDropActions,
  sensor: Omit<Sensor, "coordinates">
): SensorRegistration => (actions as SensorActions)[sensorRegistrar](sensor);

type Listeners = Record<
  string,
  (event: HTMLElementEventMap[keyof HTMLElementEventMap]) => void
>;

type DragEventHandler = (event: DragEvent) => void;

const Context = createContext<DragDropContext>();

const DragDropProvider: ParentComponent<DragDropContextProps> = (
  passedProps
) => {
  const props: Pick<Required<DragDropContextProps>, "collisionDetector"> &
    Omit<ParentProps<DragDropContextProps>, "collisionDetector"> = merge(
    { collisionDetector: mostIntersecting },
    passedProps
  );

  const [state, setState] = createStore<DragDropState>({
    draggables: {},
    droppables: {},
    sensors: {},
    active: {
      draggableId: null,
      get draggable(): Draggable | null {
        return state.active.draggableId !== null
          ? state.draggables[state.active.draggableId]
          : null;
      },
      get droppableId(): Id | null {
        return collisionSelection().droppableId;
      },
      get droppable(): Droppable | null {
        return state.active.droppableId !== null
          ? state.droppables[state.active.droppableId]
          : null;
      },
      sensorId: null,
      get sensor(): Sensor | null {
        return state.active.sensorId !== null
          ? state.sensors[state.active.sensorId]
          : null;
      },
      overlay: null,
    },
  });

  const providerOwner = getOwner()!;
  const geometryDisposers = new WeakMap<object, () => void>();

  // Explicit detection also re-evaluates geometry backed by nonreactive inputs.
  const [geometryRevision, setGeometryRevision] = createSignal(0, {
    name: "dnd.geometryRevision",
  });
  const [collisionLifecycle, setCollisionLifecycle] = createSignal(
    { epoch: 0, enabled: false },
    { name: "dnd.collisionLifecycle" }
  );
  const collisionSelection = createMemo<{
    epoch: number;
    droppableId: Id | null;
    registered: boolean;
  }>(
    (previous) => {
      const { epoch, enabled } = collisionLifecycle();
      geometryRevision();
      let droppableId = previous?.epoch === epoch ? previous.droppableId : null;
      if (
        droppableId !== null &&
        previous?.registered &&
        !state.droppables[droppableId]
      ) {
        droppableId = null;
      }

      if (!enabled) return { epoch, droppableId: null, registered: false };

      const draggable = state.active.overlay ?? state.active.draggable;
      if (draggable) {
        // Preserve movement dependencies even if a custom detector does not
        // read geometry. Previous-target context must not read our own output.
        Object.values(draggable.transform);
        const droppable = props.collisionDetector(
          draggable,
          Object.values(state.droppables),
          { activeDroppableId: droppableId }
        );
        droppableId = droppable ? droppable.id : null;
      }

      return {
        epoch,
        droppableId,
        registered: droppableId !== null && !!state.droppables[droppableId],
      };
    },
    {
      name: "dnd.collisionSelection",
      equals: (previous, next) =>
        previous.epoch === next.epoch &&
        previous.droppableId === next.droppableId &&
        previous.registered === next.registered,
    }
  );

  // Store getters run in their reader's scope. Owned memos share geometry and
  // stop equivalent results from invalidating every reader of the getter.
  const createGeometry = (
    type: "draggables" | "droppables",
    id: Id,
    initialLayout: Layout
  ) =>
    runWithOwner(providerOwner, () =>
      createRoot((dispose) => {
        const transform = createMemo(
          () => {
            geometryRevision();
            const item = state[type][id];
            if (!item || (type === "draggables" && state.active.overlay)) {
              return noopTransform();
            }

            const transformers = Object.values(item.transformers);
            transformers.sort((a, b) => a.order - b.order);
            const result = transformers.reduce(
              (transform, transformer) => transformer.callback(transform),
              noopTransform()
            );
            // A callback may return a store proxy. Capture its leaves so the
            // previous value cannot change underneath the equality comparison.
            return { x: result.x, y: result.y };
          },
          { equals: transformsAreEqual, name: `${type}.${id}.transform` }
        );
        const transformed = createMemo(
          () => {
            geometryRevision();
            return transformLayout(
              state[type][id]?.layout ?? initialLayout,
              transform()
            );
          },
          { equals: layoutsAreEqual, name: `${type}.${id}.transformed` }
        );
        return { transform, transformed, dispose };
      })
    );

  // Object merges retain store identity. Tokens distinguish registrations so
  // delayed disposal cannot remove an entry that has since been re-registered.
  const registrationTokens = new WeakMap<object, object>();
  // Replacing a registry entry must not transfer an existing drag's ownership.
  let activeSensorToken: object | undefined;
  const isCurrentRegistration = (
    current: object | null | undefined,
    entry: object,
    token: object | undefined
  ): boolean => current === entry && registrationTokens.get(entry) === token;

  const updateTransformer = (
    transformers: Record<Id, Transformer>,
    transformer: Transformer
  ) => {
    const existing = transformers[transformer.id];
    if (existing) {
      Object.assign(existing, transformer);
    } else {
      transformers[transformer.id] = transformer;
    }
    registrationTokens.set(transformers[transformer.id], {});
  };

  const addTransformer: DragDropActions["addTransformer"] = (
    type,
    id,
    transformer
  ) => {
    const displayType = type.substring(0, type.length - 1);

    if (!untrack(() => state[type][id])) {
      console.warn(
        `Cannot add transformer to nonexistent ${displayType} with id: ${id}`
      );
      return;
    }

    setState((draft) => {
      updateTransformer(draft[type][id].transformers, transformer);
    });
  };

  const removeTransformer: DragDropActions["removeTransformer"] = (
    type,
    id,
    transformerId
  ) => {
    const displayType = type.substring(0, type.length - 1);
    const item = untrack(() => state[type][id]);

    if (!item) {
      console.warn(
        `Cannot remove transformer from nonexistent ${displayType} with id: ${id}`
      );
      return;
    }

    const transformer = untrack(() => item.transformers[transformerId]);
    if (!transformer) {
      console.warn(
        `Cannot remove from ${displayType} with id ${id}, nonexistent transformer with id: ${transformerId}`
      );
      return;
    }
    const itemToken = registrationTokens.get(item);
    const transformerToken = registrationTokens.get(transformer);

    // Disposal can run in an owned scope. Defer registry writes and only
    // remove the captured registration, never a replacement using the same ID.
    queueMicrotask(() => {
      if (
        !isCurrentRegistration(state[type][id], item, itemToken) ||
        !isCurrentRegistration(
          item.transformers[transformerId],
          transformer,
          transformerToken
        )
      ) {
        return;
      }

      setState((draft) => {
        delete draft[type][id].transformers[transformerId];
      });
    });
  };

  const addDraggable: DragDropActions["addDraggable"] = ({
    id,
    node,
    layout,
    data,
  }) => {
    if (isDisposed(providerOwner)) return;
    const existingDraggable = state.draggables[id];
    const geometry = createGeometry("draggables", id, layout);

    const draggable = {
      id,
      node,
      layout,
      data,
      _pendingCleanup: false,
    };
    let transformer: Transformer | undefined;

    Object.defineProperties(draggable, {
      transformers: {
        enumerable: true,
        configurable: true,
        writable: true,
        value: {},
      },
      transform: {
        enumerable: true,
        configurable: true,
        get: geometry.transform,
      },
      transformed: {
        enumerable: true,
        configurable: true,
        get: geometry.transformed,
      },
    });
    if (
      existingDraggable &&
      state.active.draggableId === id &&
      !state.active.overlay
    ) {
      const layoutDelta = {
        x: existingDraggable.layout.x - layout.x,
        y: existingDraggable.layout.y - layout.y,
      };

      const transformerId = "addDraggable-existing-offset";
      const existingTransformer = existingDraggable.transformers[transformerId];
      const transformOffset = existingTransformer
        ? existingTransformer.callback(layoutDelta)
        : layoutDelta;

      transformer = {
        id: transformerId,
        order: 100,
        callback: (transform) => {
          return {
            x: transform.x + transformOffset.x,
            y: transform.y + transformOffset.y,
          };
        },
      };

      onDragEnd(() => removeTransformer("draggables", id, transformerId));
    }

    setState((draft) => {
      const existing = draft.draggables[id];
      if (existing) {
        // The draft may already contain a registration not yet committed.
        // Keep its geometry and discard the unused prospective root.
        geometry.dispose();
        // Merge only registration fields, preserving accessors and metadata.
        Object.assign(existing, {
          id,
          node,
          layout,
          data,
          _pendingCleanup: false,
        });
      } else {
        draft.draggables[id] = draggable as Draggable;
        geometryDisposers.set(draft.draggables[id], geometry.dispose);
      }
      registrationTokens.set(draft.draggables[id], {});
      if (transformer) {
        updateTransformer(draft.draggables[id].transformers, transformer);
      }
    });

    if (state.active.draggable) {
      recomputeLayouts();
    }
  };

  const removeDraggable: DragDropActions["removeDraggable"] = (id) => {
    const draggable = untrack(() => state.draggables[id]);
    if (!draggable) {
      console.warn(`Cannot remove nonexistent draggable with id: ${id}`);
      return;
    }
    const token = registrationTokens.get(draggable);

    // Even marking cleanup pending is a reactive write; defer it past disposal.
    queueMicrotask(() => {
      if (!isCurrentRegistration(state.draggables[id], draggable, token))
        return;

      setState((draft) => {
        draft.draggables[id]._pendingCleanup = true;
      });
      queueMicrotask(() => cleanupDraggable(id, draggable, token));
    });
  };

  const cleanupDraggable = (
    id: Id,
    draggable: Draggable,
    token: object | undefined
  ) => {
    if (
      isCurrentRegistration(state.draggables[id], draggable, token) &&
      draggable._pendingCleanup
    ) {
      const cleanupActive = state.active.draggableId === id;
      geometryDisposers.get(draggable)?.();
      geometryDisposers.delete(draggable);
      setState((draft) => {
        if (cleanupActive) {
          draft.active.draggableId = null;
        }
        delete draft.draggables[id];
      });
    }
  };

  const addDroppable: DragDropActions["addDroppable"] = ({
    id,
    node,
    layout,
    data,
    transformers,
  }: DroppableRegistration) => {
    if (isDisposed(providerOwner)) return;
    const geometry = createGeometry("droppables", id, layout);
    const droppable = {
      id,
      node,
      layout,
      data,
      _pendingCleanup: false,
    };

    // Initial transformers share the registration lifetime. Ordinary action
    // updates retain the existing transformer map, accessors, and metadata.
    Object.defineProperties(droppable, {
      transformers: {
        enumerable: true,
        configurable: true,
        writable: true,
        value: { ...transformers },
      },
      transform: {
        enumerable: true,
        configurable: true,
        get: geometry.transform,
      },
      transformed: {
        enumerable: true,
        configurable: true,
        get: geometry.transformed,
      },
    });

    setState((draft) => {
      const existing = draft.droppables[id];
      if (existing) {
        geometry.dispose();
        Object.assign(existing, {
          id,
          node,
          layout,
          data,
          _pendingCleanup: false,
        });
        if (transformers) {
          // An explicit initial map belongs to a new lifecycle registration.
          existing.transformers = { ...transformers };
        }
      } else {
        draft.droppables[id] = droppable as Droppable;
        geometryDisposers.set(draft.droppables[id], geometry.dispose);
      }
      registrationTokens.set(draft.droppables[id], {});
    });

    if (state.active.draggable) {
      recomputeLayouts();
    }
  };

  const removeDroppable: DragDropActions["removeDroppable"] = (id) => {
    const droppable = untrack(() => state.droppables[id]);
    if (!droppable) {
      console.warn(`Cannot remove nonexistent droppable with id: ${id}`);
      return;
    }
    const token = registrationTokens.get(droppable);

    // Even marking cleanup pending is a reactive write; defer it past disposal.
    queueMicrotask(() => {
      if (!isCurrentRegistration(state.droppables[id], droppable, token))
        return;

      setState((draft) => {
        draft.droppables[id]._pendingCleanup = true;
      });
      queueMicrotask(() => cleanupDroppable(id, droppable, token));
    });
  };

  const cleanupDroppable = (
    id: Id,
    droppable: Droppable,
    token: object | undefined
  ) => {
    if (
      isCurrentRegistration(state.droppables[id], droppable, token) &&
      droppable._pendingCleanup
    ) {
      geometryDisposers.get(droppable)?.();
      geometryDisposers.delete(droppable);
      setState((draft) => {
        delete draft.droppables[id];
      });
    }
  };

  const registerSensor = ({
    id,
    activators,
  }: Omit<Sensor, "coordinates">): SensorRegistration => {
    let registeredSensor!: Sensor;
    const token = {};
    setState((draft) => {
      const sensor: Sensor = {
        id,
        activators,
        coordinates: {
          origin: { x: 0, y: 0 },
          current: { x: 0, y: 0 },
          get delta() {
            return {
              x:
                state.sensors[id].coordinates.current.x -
                state.sensors[id].coordinates.origin.x,
              y:
                state.sensors[id].coordinates.current.y -
                state.sensors[id].coordinates.origin.y,
            };
          },
        },
      };
      const existing = draft.sensors[id];
      if (existing) {
        // Registration resets activators/coordinates, as the former shallow
        // merge did, while preserving the sensor record and other metadata.
        Object.assign(existing, sensor);
      } else {
        draft.sensors[id] = sensor;
      }
      registeredSensor = draft.sensors[id];
      registrationTokens.set(registeredSensor, token);
    });

    return {
      isCurrent: () =>
        untrack(
          () =>
            !isDisposed(providerOwner) &&
            isCurrentRegistration(state.sensors[id], registeredSensor, token)
        ),
      isActive: () =>
        untrack(
          () =>
            !isDisposed(providerOwner) &&
            activeSensorToken === token &&
            state.active.sensorId === id
        ),
      end: () => cleanupSensorRegistration(id, registeredSensor, token, false),
      dispose: () => removeSensorRegistration(id, registeredSensor, token),
    };
  };

  const removeSensorRegistration = (
    id: Id,
    sensor: Sensor,
    token: object | undefined
  ): void => {
    queueMicrotask(() => cleanupSensorRegistration(id, sensor, token));
  };

  const cleanupSensorRegistration = (
    id: Id,
    sensor: Sensor,
    token: object | undefined,
    remove = true
  ): void => {
    if (isDisposed(providerOwner)) return;

    let endedDrag = false;
    setState((draft) => {
      // Check the draft too: a replacement can already be staged while the
      // committed record still exposes the old registration.
      const current = isCurrentRegistration(draft.sensors[id], sensor, token);
      const ownsActive = token !== undefined && activeSensorToken === token;
      if (!current && !ownsActive) return;

      if (draft.active.sensorId === id && (ownsActive || (current && remove))) {
        const draggableId = draft.active.draggableId;
        if (draggableId !== null && draft.draggables[draggableId]) {
          delete draft.draggables[draggableId].transformers.sensorMove;
        }
        draft.active.draggableId = null;
        endedDrag = true;
        draft.active.sensorId = null;
        activeSensorToken = undefined;
      }
      if (remove && current) delete draft.sensors[id];
    });

    if (endedDrag) {
      setCollisionLifecycle(({ epoch }) => ({
        epoch: epoch + 1,
        enabled: false,
      }));
      recomputeLayouts();
    }
  };

  const addSensor: DragDropActions["addSensor"] = (sensor) => {
    registerSensor(sensor);
  };

  const removeSensor: DragDropActions["removeSensor"] = (id) => {
    const sensor = untrack(() => state.sensors[id]);
    if (!sensor) {
      console.warn(`Cannot remove nonexistent sensor with id: ${id}`);
      return;
    }
    removeSensorRegistration(id, sensor, registrationTokens.get(sensor));
  };

  const setOverlay: DragDropActions["setOverlay"] = ({ node, layout }) => {
    const overlay = {
      node,
      layout,
    };

    Object.defineProperties(overlay, {
      id: {
        enumerable: true,
        configurable: true,
        get: () => state.active.draggable?.id,
      },
      data: {
        enumerable: true,
        configurable: true,
        get: () => state.active.draggable?.data,
      },
      transformers: {
        enumerable: true,
        configurable: true,
        get: () =>
          Object.fromEntries(
            Object.entries(
              state.active.draggable ? state.active.draggable.transformers : {}
            ).filter(([id]) => id !== "addDraggable-existing-offset")
          ),
      },
      transform: {
        enumerable: true,
        configurable: true,
        get: () => {
          const transformers = Object.values(
            state.active.overlay ? state.active.overlay.transformers : []
          );
          transformers.sort((a, b) => a.order - b.order);

          return transformers.reduce(
            (transform: Transform, transformer: Transformer) => {
              return transformer.callback(transform);
            },
            noopTransform()
          );
        },
      },
      transformed: {
        enumerable: true,
        configurable: true,
        get: () => {
          return state.active.overlay
            ? transformLayout(
                state.active.overlay!.layout,
                state.active.overlay!.transform
              )
            : new Layout({ x: 0, y: 0, width: 0, height: 0 });
        },
      },
    });

    setState((draft) => {
      if (draft.active.overlay) {
        Object.assign(draft.active.overlay, { node, layout });
      } else {
        draft.active.overlay = overlay as Overlay;
      }
    });
  };

  const clearOverlay: DragDropActions["clearOverlay"] = () =>
    setState((draft) => {
      draft.active.overlay = null;
    });

  const sensorStart: DragDropActions["sensorStart"] = (id, coordinates) => {
    const { x, y } = coordinates;
    setState((draft) => {
      const { origin, current } = draft.sensors[id].coordinates;
      origin.x = x;
      origin.y = y;
      current.x = x;
      current.y = y;
      activeSensorToken = registrationTokens.get(draft.sensors[id]);
      draft.active.sensorId = id;
    });
  };

  const sensorMove: DragDropActions["sensorMove"] = (coordinates) => {
    const sensorId = state.active.sensorId;
    if (!sensorId) {
      console.warn("Cannot move sensor when no sensor active.");
      return;
    }

    const { x, y } = coordinates;
    setState((draft) => {
      const current = draft.sensors[sensorId].coordinates.current;
      current.x = x;
      current.y = y;
    });
  };

  const sensorEnd: DragDropActions["sensorEnd"] = () =>
    setState((draft) => {
      draft.active.sensorId = null;
      activeSensorToken = undefined;
    });

  const draggableActivators: DragDropActions["draggableActivators"] = (
    draggableId,
    asHandlers
  ) => {
    const eventMap: Record<
      string,
      Array<{
        sensor: Sensor;
        activator: SensorActivator<keyof HTMLElementEventMap>;
      }>
    > = {};

    for (const sensor of Object.values(state.sensors)) {
      if (sensor) {
        for (const [type, activator] of Object.entries(sensor.activators)) {
          eventMap[type] ??= [];
          eventMap[type].push({
            sensor,
            activator: activator as SensorActivator<keyof HTMLElementEventMap>,
          });
        }
      }
    }

    const listeners: Listeners = {};
    for (const key in eventMap) {
      let handlerKey = key;
      if (asHandlers) {
        handlerKey = `on${key}`;
      }
      listeners[handlerKey] = (event) => {
        for (const { activator } of eventMap[key]) {
          if (state.active.sensor) {
            break;
          }
          activator(event, draggableId);
        }
      };
    }

    return listeners;
  };

  const recomputeLayouts: DragDropActions["recomputeLayouts"] = () => {
    // Layout is a class instance, which the Solid 1 setters replaced rather
    // than merged. Keep those replacements, including its prototype getters.
    let anyLayoutChanged = false;

    const draggables = Object.values(state.draggables);
    const droppables = Object.values(state.droppables);
    const overlay = state.active.overlay;

    setState((draft) => {
      const cache: WeakMap<Element, Layout> = new WeakMap();

      for (const draggable of draggables) {
        if (draggable) {
          const currentLayout = draggable.layout;

          if (!cache.has(draggable.node))
            cache.set(draggable.node, elementLayout(draggable.node));
          const layout = cache.get(draggable.node)!;

          if (
            draft.draggables[draggable.id]?.node === draggable.node &&
            !layoutsAreEqual(currentLayout, layout)
          ) {
            draft.draggables[draggable.id].layout = layout;
            anyLayoutChanged = true;
          }
        }
      }

      for (const droppable of droppables) {
        if (droppable) {
          const currentLayout = droppable.layout;

          if (!cache.has(droppable.node))
            cache.set(droppable.node, elementLayout(droppable.node));
          const layout = cache.get(droppable.node)!;

          if (
            draft.droppables[droppable.id]?.node === droppable.node &&
            !layoutsAreEqual(currentLayout, layout)
          ) {
            draft.droppables[droppable.id].layout = layout;
            anyLayoutChanged = true;
          }
        }
      }

      if (overlay) {
        const currentLayout = overlay.layout;
        const layout = elementLayout(overlay.node);
        if (
          draft.active.overlay?.node === overlay.node &&
          !layoutsAreEqual(currentLayout, layout)
        ) {
          draft.active.overlay!.layout = layout;
          anyLayoutChanged = true;
        }
      }
    });

    return anyLayoutChanged;
  };

  const detectCollisions: DragDropActions["detectCollisions"] = () => {
    // Force a fresh geometry/selection pass at the next flush, rather than
    // reading a potentially cached winner.
    // Explicit calls can also detect against an overlay retained after drag end.
    const hasOverlay = untrack(() => state.active.overlay !== null);
    setCollisionLifecycle((current) =>
      current.enabled || !hasOverlay ? current : { ...current, enabled: true }
    );
    setGeometryRevision((revision) => revision + 1);
  };

  const dragStart: DragDropActions["dragStart"] = (draggableId) => {
    const transformer: Transformer = {
      id: "sensorMove",
      order: 0,
      callback: (transform) => {
        if (state.active.sensor) {
          return {
            x: transform.x + state.active.sensor.coordinates.delta.x,
            y: transform.y + state.active.sensor.coordinates.delta.y,
          };
        }
        return transform;
      },
    };

    recomputeLayouts();
    setCollisionLifecycle(({ epoch }) => ({ epoch, enabled: true }));

    setState((draft) => {
      draft.active.draggableId = draggableId;
      updateTransformer(
        draft.draggables[draggableId].transformers,
        transformer
      );
    });

    detectCollisions();
  };

  const dragEnd: DragDropActions["dragEnd"] = () => {
    const draggableId = untrack(() => state.active.draggableId);
    setCollisionLifecycle(({ epoch }) => ({
      epoch: epoch + 1,
      enabled: false,
    }));
    setState((draft) => {
      if (draggableId !== null) {
        delete draft.draggables[draggableId].transformers.sensorMove;
      }
      draft.active.draggableId = null;
    });

    recomputeLayouts();
  };

  const onDragStart: DragDropActions["onDragStart"] = (handler) => {
    createEffect(
      () => state.active.draggable,
      (draggable) => {
        if (draggable) {
          untrack(() => handler({ draggable }));
        }
      }
    );
  };

  const onDragMove: DragDropActions["onDragMove"] = (handler) => {
    createEffect(
      () => {
        const draggable = state.active.draggable;
        if (!draggable) return null;

        const overlay = untrack(() => state.active.overlay);
        // Track movement coordinates, even when the transform object is stable.
        Object.values(overlay ? overlay.transform : draggable.transform);
        return { draggable, overlay };
      },
      (value) => {
        if (value) {
          untrack(() => handler(value));
        }
      }
    );
  };

  const onDragOver: DragDropActions["onDragOver"] = (handler) => {
    createEffect(
      () => {
        const draggable = state.active.draggable;
        return draggable
          ? {
              draggable,
              droppable: state.active.droppable,
              overlay: untrack(() => state.active.overlay),
            }
          : null;
      },
      (value) => {
        if (value) {
          untrack(() => handler(value));
        }
      }
    );
  };

  const onDragEnd: DragDropActions["onDragEnd"] = (handler) => {
    createEffect(
      () => {
        const draggable = state.active.draggable;
        const droppable = draggable ? state.active.droppable : null;
        const overlay = draggable ? state.active.overlay : null;
        return { draggable, droppable, overlay };
      },
      (current, previous) => {
        if (!current.draggable && previous?.draggable) {
          const event = {
            draggable: previous.draggable,
            droppable: previous.droppable,
            overlay: previous.overlay,
          };
          untrack(() => handler(event));
        }
      }
    );
  };

  const onDragStartProp = untrack(() => props.onDragStart);
  const onDragMoveProp = untrack(() => props.onDragMove);
  const onDragOverProp = untrack(() => props.onDragOver);
  const onDragEndProp = untrack(() => props.onDragEnd);

  onDragStartProp && onDragStart(onDragStartProp);
  onDragMoveProp && onDragMove(onDragMoveProp);
  onDragOverProp && onDragOver(onDragOverProp);
  onDragEndProp && onDragEnd(onDragEndProp);

  const actions = {
    [sensorRegistrar]: registerSensor,
    addTransformer,
    removeTransformer,
    addDraggable,
    removeDraggable,
    addDroppable,
    removeDroppable,
    addSensor,
    removeSensor,
    setOverlay,
    clearOverlay,
    recomputeLayouts,
    detectCollisions,
    draggableActivators,
    sensorStart,
    sensorMove,
    sensorEnd,
    dragStart,
    dragEnd,
    onDragStart,
    onDragMove,
    onDragOver,
    onDragEnd,
  };

  const context: DragDropContext = [state, actions];

  return <Context value={context}>{props.children}</Context>;
};

const useDragDropContext = (): DragDropContext | null => {
  return useContext(Context) || null;
};

export {
  Context,
  DragDropProvider,
  useDragDropContext,
  registerSensorWithCleanup,
};
export type {
  Id,
  Coordinates,
  Listeners,
  DragEventHandler,
  DragEvent,
  DragDropState,
  Item,
  Draggable,
  Droppable,
  Overlay,
  SensorActivator,
  Transformer,
};
