import { createEffect, createSignal, onSettled } from "solid-js";
import type { Setter } from "solid-js";

import { Id, Transformer, useDragDropContext } from "./drag-drop-context";
import {
  elementLayout,
  noopTransform,
  Transform,
  transformsAreEqual,
} from "./layout";
import { transformStyle } from "./style";

interface Droppable {
  (element: HTMLElement, accessor?: () => { skipTransform?: boolean }): void;
  ref: Setter<HTMLElement | null>;
  get isActiveDroppable(): boolean;
  get transform(): Transform;
}

const createDroppable = (id: Id, data: Record<string, any> = {}): Droppable => {
  return createDroppableWithTransformers(id, data, []);
};

const createDroppableWithTransformers = (
  id: Id,
  data: Record<string, any>,
  transformers: readonly Transformer[]
): Droppable => {
  const [state, { addDroppable, removeDroppable }] = useDragDropContext()!;
  const [node, setNode] = createSignal<HTMLElement | null>(null);
  const [skipTransform, setSkipTransform] = createSignal(false);

  onSettled(() => {
    const resolvedNode = node();

    if (resolvedNode) {
      const registration = {
        id,
        node: resolvedNode,
        layout: elementLayout(resolvedNode),
        data,
        transformers: Object.fromEntries<Transformer>(
          transformers.map((transformer) => [transformer.id, transformer])
        ),
      };
      addDroppable(registration);

      return () => removeDroppable(id);
    }
  });

  const isActiveDroppable = () => state.active.droppableId === id;
  const transform = () => {
    return state.droppables[id]?.transform || noopTransform();
  };

  createEffect(
    () => {
      const { x, y } = transform();
      return {
        node: node(),
        transform: { x, y },
        skipTransform: skipTransform(),
      };
    },
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

  const droppable = Object.defineProperties(
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
      isActiveDroppable: {
        enumerable: true,
        get: isActiveDroppable,
      },
      transform: {
        enumerable: true,
        get: transform,
      },
    }
  ) as Droppable;

  return droppable;
};

// Internal registration helper; only createDroppable is exported by the package.
export { createDroppable, createDroppableWithTransformers };
