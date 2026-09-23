import { createEffect, createSignal, onSettled } from "solid-js";

import { createDraggable } from "./create-draggable";
import { createDroppable } from "./create-droppable";
import type { RefSetter } from "./combine-refs";
import { useSortableContext } from "./sortable-context";
import {
  Id,
  Listeners,
  Transformer,
  useDragDropContext,
} from "./drag-drop-context";
import { Layout, noopTransform, Transform, transformsAreEqual } from "./layout";
import { transformStyle } from "./style";

interface Sortable {
  (element: HTMLElement): void;
  ref: RefSetter<HTMLElement | null>;
  get transform(): Transform;
  get dragActivators(): Listeners;
  get isActiveDraggable(): boolean;
  get isActiveDroppable(): boolean;
}

const createSortable = (id: Id, data: Record<string, any> = {}): Sortable => {
  const [dndState, { addTransformer, removeTransformer }] =
    useDragDropContext()!;
  const [sortableState] = useSortableContext()!;
  const draggable = createDraggable(id, data);
  const droppable = createDroppable(id, data);
  const [node, setNode] = createSignal<HTMLElement | null>(null);
  const setRefs = (element: HTMLElement | null) => {
    draggable.ref(element);
    droppable.ref(element);
    setNode(element);
  };

  const initialIndex = (): number => sortableState.initialIds.indexOf(id);
  const currentIndex = (): number => sortableState.sortedIds.indexOf(id);
  const layoutById = (id: Id): Layout | null =>
    dndState.droppables[id]?.layout || null;

  const sortedTransform = (): Transform => {
    const delta = noopTransform();
    const resolvedInitialIndex = initialIndex();
    const resolvedCurrentIndex = currentIndex();

    if (resolvedCurrentIndex !== resolvedInitialIndex) {
      const currentLayout = layoutById(id);
      const targetLayout = layoutById(
        sortableState.initialIds[resolvedCurrentIndex]
      );

      if (currentLayout && targetLayout) {
        delta.x = targetLayout.x - currentLayout.x;
        delta.y = targetLayout.y - currentLayout.y;
      }
    }

    return delta;
  };

  const transformer: Transformer = {
    id: "sortableOffset",
    order: 100,
    callback: (transform) => {
      const delta = sortedTransform();
      return { x: transform.x + delta.x, y: transform.y + delta.y };
    },
  };

  onSettled(() => {
    addTransformer("droppables", id, transformer);
    return () => removeTransformer("droppables", id, transformer.id);
  });

  const transform = (): Transform => {
    return (
      (id === dndState.active.draggableId && !dndState.active.overlay
        ? dndState.draggables[id]?.transform
        : dndState.droppables[id]?.transform) || noopTransform()
    );
  };

  createEffect(
    () => ({ node: node(), transform: transform() }),
    ({ node: resolvedNode, transform: resolvedTransform }) => {
      if (!resolvedNode) return;

      if (!transformsAreEqual(resolvedTransform, noopTransform())) {
        const style = transformStyle(resolvedTransform);
        resolvedNode.style.setProperty("transform", style.transform ?? null);
      } else {
        resolvedNode.style.removeProperty("transform");
      }

      return () => resolvedNode.style.removeProperty("transform");
    }
  );

  const sortable = Object.defineProperties(
    (element: HTMLElement) => {
      draggable(element, () => ({ skipTransform: true }));
      droppable(element, () => ({ skipTransform: true }));
      setNode(element);
    },
    {
      ref: {
        enumerable: true,
        value: setRefs,
      },
      transform: {
        enumerable: true,
        get: transform,
      },
      isActiveDraggable: {
        enumerable: true,
        get: () => draggable.isActiveDraggable,
      },
      dragActivators: {
        enumerable: true,
        get: () => draggable.dragActivators,
      },
      isActiveDroppable: {
        enumerable: true,
        get: () => droppable.isActiveDroppable,
      },
    }
  ) as unknown as Sortable;

  return sortable;
};

export { createSortable };
