import {
  createContext,
  createEffect,
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
      droppableId: null,
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
      draft[type][id].transformers[transformer.id] = transformer;
    });
  };

  const removeTransformer: DragDropActions["removeTransformer"] = (
    type,
    id,
    transformerId
  ) => {
    const displayType = type.substring(0, type.length - 1);

    if (!untrack(() => state[type][id])) {
      console.warn(
        `Cannot remove transformer from nonexistent ${displayType} with id: ${id}`
      );
      return;
    }

    if (!untrack(() => state[type][id]["transformers"][transformerId])) {
      console.warn(
        `Cannot remove from ${displayType} with id ${id}, nonexistent transformer with id: ${transformerId}`
      );
      return;
    }

    setState((draft) => {
      delete draft[type][id].transformers[transformerId];
    });
  };

  const addDraggable: DragDropActions["addDraggable"] = ({
    id,
    node,
    layout,
    data,
  }) => {
    const existingDraggable = state.draggables[id];

    const draggable = {
      id,
      node,
      layout,
      data,
      _pendingCleanup: false,
    };
    let transformer: Transformer | undefined;

    if (!existingDraggable) {
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
          get: () => {
            if (state.active.overlay) {
              return noopTransform();
            }

            const transformers = Object.values(
              state.draggables[id].transformers
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
            return transformLayout(
              state.draggables[id].layout,
              state.draggables[id].transform
            );
          },
        },
      });
    } else if (state.active.draggableId === id && !state.active.overlay) {
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
      draft.draggables[id] = draggable as Draggable;
      if (transformer) {
        draft.draggables[id].transformers[transformer.id] = transformer;
      }
    });

    if (state.active.draggable) {
      recomputeLayouts();
    }
  };

  const removeDraggable: DragDropActions["removeDraggable"] = (id) => {
    if (!untrack(() => state.draggables[id])) {
      console.warn(`Cannot remove nonexistent draggable with id: ${id}`);
      return;
    }

    setState((draft) => {
      draft.draggables[id]._pendingCleanup = true;
    });
    queueMicrotask(() => cleanupDraggable(id));
  };

  const cleanupDraggable = (id: Id) => {
    if (state.draggables[id]?._pendingCleanup) {
      const cleanupActive = state.active.draggableId === id;
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
  }) => {
    const existingDroppable = state.droppables[id];

    const droppable = {
      id,
      node,
      layout,
      data,
      _pendingCleanup: false,
    };

    if (!existingDroppable) {
      Object.defineProperties(droppable, {
        transformers: {
          enumerable: true,
          configurable: true,
          writable: true,
          value: {},
        },
        transform: {
          enumerable: true,
          configurable: true,
          get: () => {
            const transformers = Object.values(
              state.droppables[id].transformers
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
            return transformLayout(
              state.droppables[id].layout,
              state.droppables[id].transform
            );
          },
        },
      });
    }

    setState((draft) => {
      draft.droppables[id] = droppable as Droppable;
    });

    if (state.active.draggable) {
      recomputeLayouts();
    }
  };

  const removeDroppable: DragDropActions["removeDroppable"] = (id) => {
    if (!untrack(() => state.droppables[id])) {
      console.warn(`Cannot remove nonexistent droppable with id: ${id}`);
      return;
    }

    setState((draft) => {
      draft.droppables[id]._pendingCleanup = true;
    });
    queueMicrotask(() => cleanupDroppable(id));
  };

  const cleanupDroppable = (id: Id) => {
    if (state.droppables[id]?._pendingCleanup) {
      const cleanupActive = state.active.droppableId === id;
      setState((draft) => {
        if (cleanupActive) {
          draft.active.droppableId = null;
        }
        delete draft.droppables[id];
      });
    }
  };

  const addSensor: DragDropActions["addSensor"] = ({ id, activators }) => {
    setState((draft) => {
      draft.sensors[id] = {
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
    });
  };

  const removeSensor: DragDropActions["removeSensor"] = (id) => {
    if (!untrack(() => state.sensors[id])) {
      console.warn(`Cannot remove nonexistent sensor with id: ${id}`);
      return;
    }

    const cleanupActive = state.active.sensorId === id;
    setState((draft) => {
      if (cleanupActive) {
        draft.active.sensorId = null;
      }
      delete draft.sensors[id];
    });
  };

  const setOverlay: DragDropActions["setOverlay"] = ({ node, layout }) => {
    const existing = state.active.overlay;
    const overlay = {
      node,
      layout,
    };

    if (!existing) {
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
                state.active.draggable
                  ? state.active.draggable.transformers
                  : {}
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
    }

    setState((draft) => {
      draft.active.overlay = overlay as Overlay;
    });
  };

  const clearOverlay: DragDropActions["clearOverlay"] = () =>
    setState((draft) => {
      draft.active.overlay = null;
    });

  const sensorStart: DragDropActions["sensorStart"] = (id, coordinates) => {
    setState((draft) => {
      draft.sensors[id].coordinates = {
        ...draft.sensors[id].coordinates,
        origin: { ...coordinates },
        current: { ...coordinates },
      };
      draft.active.sensorId = id;
    });
  };

  const sensorMove: DragDropActions["sensorMove"] = (coordinates) => {
    const sensorId = state.active.sensorId;
    if (!sensorId) {
      console.warn("Cannot move sensor when no sensor active.");
      return;
    }

    setState((draft) => {
      draft.sensors[sensorId].coordinates.current = {
        ...coordinates,
      };
    });
  };

  const sensorEnd: DragDropActions["sensorEnd"] = () =>
    setState((draft) => {
      draft.active.sensorId = null;
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

          if (!layoutsAreEqual(currentLayout, layout)) {
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

          if (!layoutsAreEqual(currentLayout, layout)) {
            draft.droppables[droppable.id].layout = layout;
            anyLayoutChanged = true;
          }
        }
      }

      if (overlay) {
        const currentLayout = overlay.layout;
        const layout = elementLayout(overlay.node);
        if (!layoutsAreEqual(currentLayout, layout)) {
          draft.active.overlay!.layout = layout;
          anyLayoutChanged = true;
        }
      }
    });

    return anyLayoutChanged;
  };

  const detectCollisions: DragDropActions["detectCollisions"] = () => {
    const draggable = state.active.overlay ?? state.active.draggable;
    if (draggable) {
      const droppable = props.collisionDetector(
        draggable,
        Object.values(state.droppables),
        {
          activeDroppableId: state.active.droppableId,
        }
      );

      const droppableId: Id | null = droppable ? droppable.id : null;

      if (state.active.droppableId !== droppableId) {
        setState((draft) => {
          draft.active.droppableId = droppableId;
        });
      }
    }
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

    setState((draft) => {
      draft.active.draggableId = draggableId;
      draft.draggables[draggableId].transformers[transformer.id] = transformer;
    });

    detectCollisions();
  };

  const dragEnd: DragDropActions["dragEnd"] = () => {
    const draggableId = untrack(() => state.active.draggableId);
    setState((draft) => {
      if (draggableId !== null) {
        delete draft.draggables[draggableId].transformers.sensorMove;
      }
      draft.active.draggableId = null;
      draft.active.droppableId = null;
    });

    recomputeLayouts();
  };

  const onDragStart: DragDropActions["onDragStart"] = (handler) => {
    createEffect(
      () => state.active.draggable,
      (draggable) => {
        if (draggable) {
          handler({ draggable });
        }
      }
    );
  };

  const onDragMove: DragDropActions["onDragMove"] = (handler) => {
    createEffect(
      () => {
        const draggable = state.active.draggable;
        if (!draggable) return null;

        const overlay = state.active.overlay;
        const transform = overlay ? overlay.transform : draggable.transform;
        return { draggable, overlay, transform };
      },
      (value) => {
        if (value) {
          handler({ draggable: value.draggable, overlay: value.overlay });
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
              overlay: state.active.overlay,
            }
          : null;
      },
      (value) => {
        if (value) {
          handler(value);
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
          handler({
            draggable: previous.draggable,
            droppable: previous.droppable,
            overlay: previous.overlay,
          });
        }
      }
    );
  };

  onDragMove(() => detectCollisions());

  const onDragStartProp = untrack(() => props.onDragStart);
  const onDragMoveProp = untrack(() => props.onDragMove);
  const onDragOverProp = untrack(() => props.onDragOver);
  const onDragEndProp = untrack(() => props.onDragEnd);

  onDragStartProp && onDragStart(onDragStartProp);
  onDragMoveProp && onDragMove(onDragMoveProp);
  onDragOverProp && onDragOver(onDragOverProp);
  onDragEndProp && onDragEnd(onDragEndProp);

  const actions = {
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

export { Context, DragDropProvider, useDragDropContext };
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
