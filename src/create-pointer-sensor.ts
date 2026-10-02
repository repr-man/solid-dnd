import { onSettled, untrack } from "solid-js";

import {
  Coordinates,
  Id,
  SensorActivator,
  registerSensorWithCleanup,
  useDragDropContext,
} from "./drag-drop-context";
import { Transform } from "./layout";

const createPointerSensor = (id: Id = "pointer-sensor"): void => {
  const [state, actions] = useDragDropContext()!;
  const { sensorStart, sensorMove, dragStart } = actions;
  const activationDelay = 250; // milliseconds
  const activationDistance = 10; // pixels
  let registration: ReturnType<typeof registerSensorWithCleanup> | null = null;
  let disposed = false;
  let activated = false;

  onSettled(() => {
    const registered = registerSensorWithCleanup(actions, {
      id,
      activators: { pointerdown: attach },
    });
    registration = registered;

    return () => {
      if (disposed) return;
      disposed = true;
      // Native resources are released immediately; registry/drag writes are
      // deferred by the registration handle until outside owner disposal.
      detach();
      registered.dispose();
    };
  });

  const isActiveSensor = () => registration?.isActive();

  const initialCoordinates: Coordinates = { x: 0, y: 0 };

  let activationDelayTimeoutId: number | null = null;
  let activationDraggableId: Id | null = null;

  const attach: SensorActivator<"pointerdown"> = (event, draggableId) => {
    if (
      event.button !== 0 ||
      disposed ||
      activated ||
      !registration?.isCurrent()
    )
      return;

    detach();

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);

    activationDraggableId = draggableId;
    initialCoordinates.x = event.clientX;
    initialCoordinates.y = event.clientY;

    activationDelayTimeoutId = window.setTimeout(onActivate, activationDelay);
  };

  const clearActivationTimer = (): void => {
    if (activationDelayTimeoutId !== null) {
      clearTimeout(activationDelayTimeoutId);
      activationDelayTimeoutId = null;
    }
  };

  const detach = (): void => {
    clearActivationTimer();
    activationDraggableId = null;
    activated = false;

    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("selectionchange", clearSelection);
  };

  const cancel = (): void => {
    const wasActivated = activated;
    detach();
    if (wasActivated) registration?.end();
  };

  const onActivate = (): void => {
    if (disposed || !registration?.isCurrent()) {
      cancel();
      return;
    }
    if (activated || activationDraggableId === null) return;

    clearActivationTimer();
    if (!untrack(() => state.active.sensor)) {
      activated = true;
      sensorStart(id, initialCoordinates);
      dragStart(activationDraggableId);

      clearSelection();
      document.addEventListener("selectionchange", clearSelection);
    } else if (!isActiveSensor()) {
      detach();
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (disposed || !registration?.isCurrent()) {
      cancel();
      return;
    }
    if (activationDraggableId === null) return;

    const coordinates: Coordinates = { x: event.clientX, y: event.clientY };

    if (!activated && !untrack(() => state.active.sensor)) {
      const transform: Transform = {
        x: coordinates.x - initialCoordinates.x,
        y: coordinates.y - initialCoordinates.y,
      };

      if (Math.sqrt(transform.x ** 2 + transform.y ** 2) > activationDistance) {
        onActivate();
      }
    }

    if (isActiveSensor()) {
      event.preventDefault();
      sensorMove(coordinates);
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (activated) event.preventDefault();
    cancel();
  };

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
  };
};

export { createPointerSensor };
