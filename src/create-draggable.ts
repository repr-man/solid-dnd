import { createEffect, createSignal, onSettled } from "solid-js";
import type { Setter } from "solid-js";

import { Id, Listeners, useDragDropContext } from "./drag-drop-context";
import {
  elementLayout,
  noopTransform,
  Transform,
  transformsAreEqual,
} from "./layout";
import { transformStyle } from "./style";

interface Draggable {
  (element: HTMLElement, accessor?: () => { skipTransform?: boolean }): void;
  ref: Setter<HTMLElement | null>;
  get isActiveDraggable(): boolean;
  get dragActivators(): Listeners;
  get transform(): Transform;
}

const createDraggable = (id: Id, data: Record<string, any> = {}): Draggable => {
  const [state, { addDraggable, removeDraggable, draggableActivators }] =
    useDragDropContext()!;
  const [node, setNode] = createSignal<HTMLElement | null>(null);
  const [skipTransform, setSkipTransform] = createSignal(false);

  onSettled(() => {
    const resolvedNode = node();

    if (resolvedNode) {
      addDraggable({
        id,
        node: resolvedNode,
        layout: elementLayout(resolvedNode),
        data,
      });
    }

    return () => removeDraggable(id);
  });

  const isActiveDraggable = () => state.active.draggableId === id;
  const transform = () => {
    return state.draggables[id]?.transform || noopTransform();
  };

  createEffect(
    () => ({
      node: node(),
      activators: draggableActivators(id),
    }),
    ({ node: resolvedNode, activators }) => {
      if (!resolvedNode) return;

      for (const key in activators) {
        resolvedNode.addEventListener(key, activators[key]);
      }

      return () => {
        for (const key in activators) {
          resolvedNode.removeEventListener(key, activators[key]);
        }
      };
    }
  );

  createEffect(
    () => ({
      node: node(),
      transform: transform(),
      skipTransform: skipTransform(),
    }),
    ({ node: resolvedNode, transform: resolvedTransform, skipTransform }) => {
      if (!resolvedNode || skipTransform) return;

      if (!transformsAreEqual(resolvedTransform, noopTransform())) {
        const style = transformStyle(resolvedTransform);
        resolvedNode.style.setProperty("transform", style.transform ?? null);
      } else {
        resolvedNode.style.removeProperty("transform");
      }

      return () => resolvedNode.style.removeProperty("transform");
    }
  );

  const draggable = Object.defineProperties(
    (element: HTMLElement, accessor?: () => { skipTransform?: boolean }) => {
      const config = accessor ? accessor() : {};
      setSkipTransform(Boolean(config.skipTransform));
      setNode(element);
    },
    {
      ref: {
        enumerable: true,
        value: setNode,
      },
      isActiveDraggable: {
        enumerable: true,
        get: isActiveDraggable,
      },
      dragActivators: {
        enumerable: true,
        get: () => {
          return draggableActivators(id, true);
        },
      },
      transform: {
        enumerable: true,
        get: transform,
      },
    }
  ) as Draggable;

  return draggable;
};

export { createDraggable };
