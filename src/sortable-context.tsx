import {
  createContext,
  createEffect,
  createStore,
  onSettled,
  untrack,
  useContext,
} from "solid-js";
import type { ParentComponent, Store } from "solid-js";

import { Id, useDragDropContext } from "./drag-drop-context";
import { moveArrayItem } from "./move-array-item";

interface SortableContextState {
  initialIds: Array<Id>;
  sortedIds: Array<Id>;
}

interface SortableContextProps {
  ids: Array<Id>;
}

type SortableContext = [Store<SortableContextState>, {}];

const Context = createContext<SortableContext>();

const SortableProvider: ParentComponent<SortableContextProps> = (props) => {
  const [dndState] = useDragDropContext()!;

  const [state, setState] = createStore<SortableContextState>({
    initialIds: [],
    sortedIds: [],
  });

  const isValidIndex = (index: number): boolean => {
    return index >= 0 && index < state.initialIds.length;
  };

  createEffect(
    () => props.ids,
    (ids) => {
      setState((draft) => {
        draft.initialIds = [...ids];
        draft.sortedIds = [...ids];
      });
    }
  );

  createEffect(
    () => ({
      draggableId: dndState.active.draggableId,
      droppableId: dndState.active.droppableId,
      ids: props.ids,
      initialIds: untrack(() => [...state.initialIds]),
      sortedIds: untrack(() => [...state.sortedIds]),
    }),
    ({ draggableId, droppableId, ids, initialIds, sortedIds }) => {
      if (draggableId && droppableId) {
        const fromIndex = sortedIds.indexOf(draggableId);
        const toIndex = initialIds.indexOf(droppableId);

        if (!isValidIndex(fromIndex) || !isValidIndex(toIndex)) {
          setState((draft) => {
            draft.sortedIds = [...ids];
          });
        } else if (fromIndex !== toIndex) {
          const resorted = moveArrayItem(sortedIds, fromIndex, toIndex);
          setState((draft) => {
            draft.sortedIds = resorted;
          });
        }
      } else {
        setState((draft) => {
          draft.sortedIds = [...ids];
        });
      }
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
