import { JSX } from "@solidjs/web";
import { Component, ParentComponent, Setter, Store } from "solid-js";
//#region src/collision.d.ts
type CollisionDetector = (draggable: Draggable, droppables: Droppable[], context: {
  activeDroppableId: Id | null;
}) => Droppable | null;
declare const closestCenter: CollisionDetector;
declare const closestCorners: CollisionDetector;
declare const mostIntersecting: CollisionDetector;
//#endregion
//#region src/layout.d.ts
interface Point {
  x: number;
  y: number;
}
interface Transform {
  x: number;
  y: number;
}
declare class Layout {
  x: number;
  y: number;
  width: number;
  height: number;
  constructor(rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  });
  get rect(): {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  get left(): number;
  get top(): number;
  get right(): number;
  get bottom(): number;
  get center(): Point;
  get corners(): {
    topLeft: Point;
    topRight: Point;
    bottomRight: Point;
    bottomLeft: Point;
  };
}
//#endregion
//#region src/drag-drop-context.d.ts
type Id = string | number;
interface Coordinates {
  x: number;
  y: number;
}
type SensorActivator<K extends keyof HTMLElementEventMap> = (event: HTMLElementEventMap[K], draggableId: Id) => void;
interface Sensor {
  id: Id;
  activators: { [K in keyof HTMLElementEventMap]?: SensorActivator<K>; };
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
  addTransformer(type: "draggables" | "droppables", id: Id, transformer: Transformer): void;
  removeTransformer(type: "draggables" | "droppables", id: Id, transformerId: Id): void;
  addDraggable(draggable: Omit<Draggable, "transform" | "transformed" | "transformers">): void;
  removeDraggable(id: Id): void;
  addDroppable(droppable: Omit<Droppable, "transform" | "transformed" | "transformers">): void;
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
type Listeners = Record<string, (event: HTMLElementEventMap[keyof HTMLElementEventMap]) => void>;
type DragEventHandler = (event: DragEvent) => void;
declare const DragDropProvider: ParentComponent<DragDropContextProps>;
declare const useDragDropContext: () => DragDropContext | null;
//#endregion
//#region src/drag-drop-sensors.d.ts
declare const DragDropSensors: ParentComponent;
//#endregion
//#region src/create-pointer-sensor.d.ts
declare const createPointerSensor: (id?: Id) => void;
//#endregion
//#region src/create-draggable.d.ts
interface Draggable$1 {
  (element: HTMLElement, accessor?: () => {
    skipTransform?: boolean;
  }): void;
  ref: Setter<HTMLElement | null>;
  get isActiveDraggable(): boolean;
  get dragActivators(): Listeners;
  get transform(): Transform;
}
declare const createDraggable: (id: Id, data?: Record<string, any>) => Draggable$1;
//#endregion
//#region src/create-droppable.d.ts
interface Droppable$1 {
  (element: HTMLElement, accessor?: () => {
    skipTransform?: boolean;
  }): void;
  ref: Setter<HTMLElement | null>;
  get isActiveDroppable(): boolean;
  get transform(): Transform;
}
declare const createDroppable: (id: Id, data?: Record<string, any>) => Droppable$1;
//#endregion
//#region src/drag-overlay.d.ts
interface DragOverlayProps {
  children: JSX.Element | ((activeDraggable: Draggable | null) => JSX.Element);
  class?: string;
  style?: JSX.CSSProperties;
}
declare const DragOverlay: Component<DragOverlayProps>;
//#endregion
//#region src/sortable-context.d.ts
interface SortableContextState {
  initialIds: Array<Id>;
  sortedIds: Array<Id>;
}
interface SortableContextProps {
  ids: Array<Id>;
}
type SortableContext = [Store<SortableContextState>, {}];
declare const SortableProvider: ParentComponent<SortableContextProps>;
declare const useSortableContext: () => SortableContext | null;
//#endregion
//#region src/combine-refs.d.ts
type RefSetter<V> = (value: V) => void;
//#endregion
//#region src/create-sortable.d.ts
interface Sortable {
  (element: HTMLElement): void;
  ref: RefSetter<HTMLElement | null>;
  get transform(): Transform;
  get dragActivators(): Listeners;
  get isActiveDraggable(): boolean;
  get isActiveDroppable(): boolean;
}
declare const createSortable: (id: Id, data?: Record<string, any>) => Sortable;
//#endregion
//#region src/style.d.ts
declare const layoutStyle: (layout: Layout) => JSX.CSSProperties;
declare const transformStyle: (transform: Transform) => JSX.CSSProperties;
declare const maybeTransformStyle: (transform: Transform) => JSX.CSSProperties;
//#endregion
//#region src/drag-drop-debugger.d.ts
declare const DragDropDebugger: () => JSX.Element;
//#endregion
export { type CollisionDetector, DragDropDebugger, DragDropProvider, DragDropSensors, type DragEvent, type DragEventHandler, DragOverlay, type Draggable, type Droppable, type Id, SortableProvider, type Transformer, closestCenter, closestCorners, createDraggable, createDroppable, createPointerSensor, createSortable, layoutStyle, maybeTransformStyle, mostIntersecting, transformStyle, useDragDropContext, useSortableContext };