import { createContext, createEffect, createStore, useContext } from "solid-js";
import type { ParentComponent, Store } from "solid-js";

import { Id, useDragDropContext } from "./drag-drop-context";

interface SortableContextState {
  initialIds: Array<Id>;
  sortedIds: Array<Id>;
}

interface SortableContextProps {
  ids: Array<Id>;
}

type SortableContext = [Store<SortableContextState>, {}];

const Context = createContext<SortableContext>();

// Retain the store array and leave unchanged indices untouched.
const updateIds = (target: Id[], ids: readonly Id[]): boolean => {
  let changed = target.length !== ids.length;
  for (let index = 0; index < ids.length; index++) {
    if (target[index] !== ids[index]) {
      target[index] = ids[index];
      changed = true;
    }
  }
  if (target.length !== ids.length) target.length = ids.length;
  return changed;
};

const SortableProvider: ParentComponent<SortableContextProps> = (props) => {
  const [dndState] = useDragDropContext()!;

  const [state, setState] = createStore<SortableContextState>({
    initialIds: [],
    sortedIds: [],
  });

  createEffect(
    () => ({
      draggableId: dndState.active.draggableId,
      droppableId: dndState.active.droppableId,
      ids: [...props.ids],
    }),
    ({ draggableId, droppableId, ids }) => {
      setState((draft) => {
        const { initialIds, sortedIds } = draft;
        // Synchronize before calculating the preview, using the current draft.
        if (updateIds(initialIds, ids)) updateIds(sortedIds, ids);

        if (draggableId === null || droppableId === null) {
          updateIds(sortedIds, ids);
          return;
        }

        const fromIndex = sortedIds.indexOf(draggableId);
        const toIndex = initialIds.indexOf(droppableId);
        const isValidIndex = (index: number): boolean =>
          index >= 0 && index < initialIds.length && index < sortedIds.length;

        if (!isValidIndex(fromIndex) || !isValidIndex(toIndex)) {
          updateIds(sortedIds, ids);
        } else if (fromIndex !== toIndex) {
          const movedId = sortedIds[fromIndex];
          const direction = fromIndex < toIndex ? 1 : -1;
          for (let index = fromIndex; index !== toIndex; index += direction) {
            const nextId = sortedIds[index + direction];
            if (sortedIds[index] !== nextId) sortedIds[index] = nextId;
          }
          if (sortedIds[toIndex] !== movedId) sortedIds[toIndex] = movedId;
        }
      });
    }
  );

  const actions = {};
  const context: SortableContext = [state, actions];

  return <Context value={context}>{props.children}</Context>;
};

const useSortableContext = (): SortableContext | null => {
  return useContext(Context) || null;
};

export { Context, SortableProvider, useSortableContext };
