import { Portal, Show, className, createComponent, effect, getNextElement, insert, memo, readShallow, ref, scope, style, template } from "@solidjs/web";
import { For, Show as Show$1, createContext, createEffect, createMemo, createRoot, createSignal, createStore, getOwner, isDisposed, merge, onSettled, runWithOwner, untrack, useContext } from "solid-js";
//#region src/layout.ts
var Layout = class {
	x;
	y;
	width;
	height;
	constructor(rect) {
		this.x = Math.floor(rect.x);
		this.y = Math.floor(rect.y);
		this.width = Math.floor(rect.width);
		this.height = Math.floor(rect.height);
	}
	get rect() {
		return {
			x: this.x,
			y: this.y,
			width: this.width,
			height: this.height
		};
	}
	get left() {
		return this.x;
	}
	get top() {
		return this.y;
	}
	get right() {
		return this.x + this.width;
	}
	get bottom() {
		return this.y + this.height;
	}
	get center() {
		return {
			x: this.x + this.width * .5,
			y: this.y + this.height * .5
		};
	}
	get corners() {
		return {
			topLeft: {
				x: this.left,
				y: this.top
			},
			topRight: {
				x: this.right,
				y: this.top
			},
			bottomRight: {
				x: this.left,
				y: this.bottom
			},
			bottomLeft: {
				x: this.right,
				y: this.bottom
			}
		};
	}
};
const elementLayout = (element) => {
	let layout = new Layout(element.getBoundingClientRect());
	const { transform } = getComputedStyle(element);
	if (transform) layout = stripTransformFromLayout(layout, transform);
	return layout;
};
const stripTransformFromLayout = (layout, transform) => {
	let translateX, translateY;
	if (transform.startsWith("matrix3d(")) {
		const matrix = transform.slice(9, -1).split(/, /);
		translateX = +matrix[12];
		translateY = +matrix[13];
	} else if (transform.startsWith("matrix(")) {
		const matrix = transform.slice(7, -1).split(/, /);
		translateX = +matrix[4];
		translateY = +matrix[5];
	} else {
		translateX = 0;
		translateY = 0;
	}
	return new Layout({
		...layout,
		x: layout.x - translateX,
		y: layout.y - translateY
	});
};
const noopTransform = () => ({
	x: 0,
	y: 0
});
const transformsAreEqual = (firstTransform, secondTransform) => {
	return firstTransform.x === secondTransform.x && firstTransform.y === secondTransform.y;
};
const transformLayout = (layout, transform) => {
	return new Layout({
		...layout,
		x: layout.x + transform.x,
		y: layout.y + transform.y
	});
};
const distanceBetweenPoints = (firstPoint, secondPoint) => {
	return Math.sqrt(Math.pow(firstPoint.x - secondPoint.x, 2) + Math.pow(firstPoint.y - secondPoint.y, 2));
};
const intersectionRatioOfLayouts = (firstLayout, secondLayout) => {
	const top = Math.max(firstLayout.top, secondLayout.top);
	const left = Math.max(firstLayout.left, secondLayout.left);
	const right = Math.min(firstLayout.right, secondLayout.right);
	const bottom = Math.min(firstLayout.bottom, secondLayout.bottom);
	const width = right - left;
	const height = bottom - top;
	if (left < right && top < bottom) {
		const layout1Area = firstLayout.width * firstLayout.height;
		const layout2Area = secondLayout.width * secondLayout.height;
		const intersectionArea = width * height;
		return intersectionArea / (layout1Area + layout2Area - intersectionArea);
	}
	return 0;
};
const layoutsAreEqual = (firstLayout, secondLayout) => {
	return firstLayout.x === secondLayout.x && firstLayout.y === secondLayout.y && firstLayout.width === secondLayout.width && firstLayout.height === secondLayout.height;
};
//#endregion
//#region src/collision.ts
const closestCenter = (draggable, droppables, context) => {
	const point1 = draggable.transformed.center;
	const collision = {
		distance: Infinity,
		droppable: null
	};
	for (const droppable of droppables) {
		const distance = distanceBetweenPoints(point1, droppable.layout.center);
		if (distance < collision.distance) {
			collision.distance = distance;
			collision.droppable = droppable;
		} else if (distance === collision.distance && droppable.id === context.activeDroppableId) collision.droppable = droppable;
	}
	return collision.droppable;
};
const closestCorners = (draggable, droppables, context) => {
	const draggableCorners = draggable.transformed.corners;
	const collision = {
		distance: Infinity,
		droppable: null
	};
	for (const droppable of droppables) {
		const droppableCorners = droppable.layout.corners;
		const distance = distanceBetweenPoints(droppableCorners.topLeft, draggableCorners.topLeft) + distanceBetweenPoints(droppableCorners.topRight, draggableCorners.topRight) + distanceBetweenPoints(droppableCorners.bottomRight, draggableCorners.bottomRight) + distanceBetweenPoints(droppableCorners.bottomLeft, draggableCorners.bottomLeft);
		if (distance < collision.distance) {
			collision.distance = distance;
			collision.droppable = droppable;
		} else if (distance === collision.distance && droppable.id === context.activeDroppableId) collision.droppable = droppable;
	}
	return collision.droppable;
};
const mostIntersecting = (draggable, droppables, context) => {
	const draggableLayout = draggable.transformed;
	const collision = {
		ratio: 0,
		droppable: null
	};
	for (const droppable of droppables) {
		const ratio = intersectionRatioOfLayouts(draggableLayout, droppable.layout);
		if (ratio > collision.ratio) {
			collision.ratio = ratio;
			collision.droppable = droppable;
		} else if (ratio > 0 && ratio === collision.ratio && droppable.id === context.activeDroppableId) collision.droppable = droppable;
	}
	return collision.droppable;
};
//#endregion
//#region src/drag-drop-context.tsx
const Context$1 = createContext();
const DragDropProvider = (passedProps) => {
	const props = merge({ collisionDetector: mostIntersecting }, passedProps);
	const [state, setState] = createStore({
		draggables: {},
		droppables: {},
		sensors: {},
		active: {
			draggableId: null,
			get draggable() {
				return state.active.draggableId !== null ? state.draggables[state.active.draggableId] : null;
			},
			droppableId: null,
			get droppable() {
				return state.active.droppableId !== null ? state.droppables[state.active.droppableId] : null;
			},
			sensorId: null,
			get sensor() {
				return state.active.sensorId !== null ? state.sensors[state.active.sensorId] : null;
			},
			overlay: null
		}
	});
	const providerOwner = getOwner();
	const geometryDisposers = /* @__PURE__ */ new WeakMap();
	const createGeometry = (type, id, initialLayout) => runWithOwner(providerOwner, () => createRoot((dispose) => {
		const transform = createMemo(() => {
			const item = state[type][id];
			if (!item || type === "draggables" && state.active.overlay) return noopTransform();
			const transformers = Object.values(item.transformers);
			transformers.sort((a, b) => a.order - b.order);
			const result = transformers.reduce((transform, transformer) => transformer.callback(transform), noopTransform());
			return {
				x: result.x,
				y: result.y
			};
		}, {
			equals: transformsAreEqual,
			name: `${type}.${id}.transform`
		});
		return {
			transform,
			transformed: createMemo(() => transformLayout(state[type][id]?.layout ?? initialLayout, transform()), {
				equals: layoutsAreEqual,
				name: `${type}.${id}.transformed`
			}),
			dispose
		};
	}));
	const registrationTokens = /* @__PURE__ */ new WeakMap();
	const isCurrentRegistration = (current, entry, token) => current === entry && registrationTokens.get(entry) === token;
	const updateTransformer = (transformers, transformer) => {
		const existing = transformers[transformer.id];
		if (existing) Object.assign(existing, transformer);
		else transformers[transformer.id] = transformer;
		registrationTokens.set(transformers[transformer.id], {});
	};
	const addTransformer = (type, id, transformer) => {
		const displayType = type.substring(0, type.length - 1);
		if (!untrack(() => state[type][id])) {
			console.warn(`Cannot add transformer to nonexistent ${displayType} with id: ${id}`);
			return;
		}
		setState((draft) => {
			updateTransformer(draft[type][id].transformers, transformer);
		});
	};
	const removeTransformer = (type, id, transformerId) => {
		const displayType = type.substring(0, type.length - 1);
		const item = untrack(() => state[type][id]);
		if (!item) {
			console.warn(`Cannot remove transformer from nonexistent ${displayType} with id: ${id}`);
			return;
		}
		const transformer = untrack(() => item.transformers[transformerId]);
		if (!transformer) {
			console.warn(`Cannot remove from ${displayType} with id ${id}, nonexistent transformer with id: ${transformerId}`);
			return;
		}
		const itemToken = registrationTokens.get(item);
		const transformerToken = registrationTokens.get(transformer);
		queueMicrotask(() => {
			if (!isCurrentRegistration(state[type][id], item, itemToken) || !isCurrentRegistration(item.transformers[transformerId], transformer, transformerToken)) return;
			setState((draft) => {
				delete draft[type][id].transformers[transformerId];
			});
		});
	};
	const addDraggable = ({ id, node, layout, data }) => {
		if (isDisposed(providerOwner)) return;
		const existingDraggable = state.draggables[id];
		const geometry = createGeometry("draggables", id, layout);
		const draggable = {
			id,
			node,
			layout,
			data,
			_pendingCleanup: false
		};
		let transformer;
		Object.defineProperties(draggable, {
			transformers: {
				enumerable: true,
				configurable: true,
				writable: true,
				value: {}
			},
			transform: {
				enumerable: true,
				configurable: true,
				get: geometry.transform
			},
			transformed: {
				enumerable: true,
				configurable: true,
				get: geometry.transformed
			}
		});
		if (existingDraggable && state.active.draggableId === id && !state.active.overlay) {
			const layoutDelta = {
				x: existingDraggable.layout.x - layout.x,
				y: existingDraggable.layout.y - layout.y
			};
			const transformerId = "addDraggable-existing-offset";
			const existingTransformer = existingDraggable.transformers[transformerId];
			const transformOffset = existingTransformer ? existingTransformer.callback(layoutDelta) : layoutDelta;
			transformer = {
				id: transformerId,
				order: 100,
				callback: (transform) => {
					return {
						x: transform.x + transformOffset.x,
						y: transform.y + transformOffset.y
					};
				}
			};
			onDragEnd(() => removeTransformer("draggables", id, transformerId));
		}
		setState((draft) => {
			const existing = draft.draggables[id];
			if (existing) {
				geometry.dispose();
				Object.assign(existing, {
					id,
					node,
					layout,
					data,
					_pendingCleanup: false
				});
			} else {
				draft.draggables[id] = draggable;
				geometryDisposers.set(draft.draggables[id], geometry.dispose);
			}
			registrationTokens.set(draft.draggables[id], {});
			if (transformer) updateTransformer(draft.draggables[id].transformers, transformer);
		});
		if (state.active.draggable) recomputeLayouts();
	};
	const removeDraggable = (id) => {
		const draggable = untrack(() => state.draggables[id]);
		if (!draggable) {
			console.warn(`Cannot remove nonexistent draggable with id: ${id}`);
			return;
		}
		const token = registrationTokens.get(draggable);
		queueMicrotask(() => {
			if (!isCurrentRegistration(state.draggables[id], draggable, token)) return;
			setState((draft) => {
				draft.draggables[id]._pendingCleanup = true;
			});
			queueMicrotask(() => cleanupDraggable(id, draggable, token));
		});
	};
	const cleanupDraggable = (id, draggable, token) => {
		if (isCurrentRegistration(state.draggables[id], draggable, token) && draggable._pendingCleanup) {
			const cleanupActive = state.active.draggableId === id;
			geometryDisposers.get(draggable)?.();
			geometryDisposers.delete(draggable);
			setState((draft) => {
				if (cleanupActive) draft.active.draggableId = null;
				delete draft.draggables[id];
			});
		}
	};
	const addDroppable = ({ id, node, layout, data, transformers }) => {
		if (isDisposed(providerOwner)) return;
		const geometry = createGeometry("droppables", id, layout);
		const droppable = {
			id,
			node,
			layout,
			data,
			_pendingCleanup: false
		};
		Object.defineProperties(droppable, {
			transformers: {
				enumerable: true,
				configurable: true,
				writable: true,
				value: { ...transformers }
			},
			transform: {
				enumerable: true,
				configurable: true,
				get: geometry.transform
			},
			transformed: {
				enumerable: true,
				configurable: true,
				get: geometry.transformed
			}
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
					_pendingCleanup: false
				});
				if (transformers) existing.transformers = { ...transformers };
			} else {
				draft.droppables[id] = droppable;
				geometryDisposers.set(draft.droppables[id], geometry.dispose);
			}
			registrationTokens.set(draft.droppables[id], {});
		});
		if (state.active.draggable) recomputeLayouts();
	};
	const removeDroppable = (id) => {
		const droppable = untrack(() => state.droppables[id]);
		if (!droppable) {
			console.warn(`Cannot remove nonexistent droppable with id: ${id}`);
			return;
		}
		const token = registrationTokens.get(droppable);
		queueMicrotask(() => {
			if (!isCurrentRegistration(state.droppables[id], droppable, token)) return;
			setState((draft) => {
				draft.droppables[id]._pendingCleanup = true;
			});
			queueMicrotask(() => cleanupDroppable(id, droppable, token));
		});
	};
	const cleanupDroppable = (id, droppable, token) => {
		if (isCurrentRegistration(state.droppables[id], droppable, token) && droppable._pendingCleanup) {
			const cleanupActive = state.active.droppableId === id;
			geometryDisposers.get(droppable)?.();
			geometryDisposers.delete(droppable);
			setState((draft) => {
				if (cleanupActive) draft.active.droppableId = null;
				delete draft.droppables[id];
			});
		}
	};
	const addSensor = ({ id, activators }) => {
		setState((draft) => {
			const sensor = {
				id,
				activators,
				coordinates: {
					origin: {
						x: 0,
						y: 0
					},
					current: {
						x: 0,
						y: 0
					},
					get delta() {
						return {
							x: state.sensors[id].coordinates.current.x - state.sensors[id].coordinates.origin.x,
							y: state.sensors[id].coordinates.current.y - state.sensors[id].coordinates.origin.y
						};
					}
				}
			};
			const existing = draft.sensors[id];
			if (existing) Object.assign(existing, sensor);
			else draft.sensors[id] = sensor;
			registrationTokens.set(draft.sensors[id], {});
		});
	};
	const removeSensor = (id) => {
		const sensor = untrack(() => state.sensors[id]);
		if (!sensor) {
			console.warn(`Cannot remove nonexistent sensor with id: ${id}`);
			return;
		}
		const token = registrationTokens.get(sensor);
		queueMicrotask(() => {
			if (!isCurrentRegistration(state.sensors[id], sensor, token)) return;
			const cleanupActive = state.active.sensorId === id;
			setState((draft) => {
				if (cleanupActive) draft.active.sensorId = null;
				delete draft.sensors[id];
			});
		});
	};
	const setOverlay = ({ node, layout }) => {
		const overlay = {
			node,
			layout
		};
		Object.defineProperties(overlay, {
			id: {
				enumerable: true,
				configurable: true,
				get: () => state.active.draggable?.id
			},
			data: {
				enumerable: true,
				configurable: true,
				get: () => state.active.draggable?.data
			},
			transformers: {
				enumerable: true,
				configurable: true,
				get: () => Object.fromEntries(Object.entries(state.active.draggable ? state.active.draggable.transformers : {}).filter(([id]) => id !== "addDraggable-existing-offset"))
			},
			transform: {
				enumerable: true,
				configurable: true,
				get: () => {
					const transformers = Object.values(state.active.overlay ? state.active.overlay.transformers : []);
					transformers.sort((a, b) => a.order - b.order);
					return transformers.reduce((transform, transformer) => {
						return transformer.callback(transform);
					}, noopTransform());
				}
			},
			transformed: {
				enumerable: true,
				configurable: true,
				get: () => {
					return state.active.overlay ? transformLayout(state.active.overlay.layout, state.active.overlay.transform) : new Layout({
						x: 0,
						y: 0,
						width: 0,
						height: 0
					});
				}
			}
		});
		setState((draft) => {
			if (draft.active.overlay) Object.assign(draft.active.overlay, {
				node,
				layout
			});
			else draft.active.overlay = overlay;
		});
	};
	const clearOverlay = () => setState((draft) => {
		draft.active.overlay = null;
	});
	const sensorStart = (id, coordinates) => {
		const { x, y } = coordinates;
		setState((draft) => {
			const { origin, current } = draft.sensors[id].coordinates;
			origin.x = x;
			origin.y = y;
			current.x = x;
			current.y = y;
			draft.active.sensorId = id;
		});
	};
	const sensorMove = (coordinates) => {
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
	const sensorEnd = () => setState((draft) => {
		draft.active.sensorId = null;
	});
	const draggableActivators = (draggableId, asHandlers) => {
		const eventMap = {};
		for (const sensor of Object.values(state.sensors)) if (sensor) for (const [type, activator] of Object.entries(sensor.activators)) {
			eventMap[type] ??= [];
			eventMap[type].push({
				sensor,
				activator
			});
		}
		const listeners = {};
		for (const key in eventMap) {
			let handlerKey = key;
			if (asHandlers) handlerKey = `on${key}`;
			listeners[handlerKey] = (event) => {
				for (const { activator } of eventMap[key]) {
					if (state.active.sensor) break;
					activator(event, draggableId);
				}
			};
		}
		return listeners;
	};
	const recomputeLayouts = () => {
		let anyLayoutChanged = false;
		const draggables = Object.values(state.draggables);
		const droppables = Object.values(state.droppables);
		const overlay = state.active.overlay;
		setState((draft) => {
			const cache = /* @__PURE__ */ new WeakMap();
			for (const draggable of draggables) if (draggable) {
				const currentLayout = draggable.layout;
				if (!cache.has(draggable.node)) cache.set(draggable.node, elementLayout(draggable.node));
				const layout = cache.get(draggable.node);
				if (!layoutsAreEqual(currentLayout, layout)) {
					draft.draggables[draggable.id].layout = layout;
					anyLayoutChanged = true;
				}
			}
			for (const droppable of droppables) if (droppable) {
				const currentLayout = droppable.layout;
				if (!cache.has(droppable.node)) cache.set(droppable.node, elementLayout(droppable.node));
				const layout = cache.get(droppable.node);
				if (!layoutsAreEqual(currentLayout, layout)) {
					draft.droppables[droppable.id].layout = layout;
					anyLayoutChanged = true;
				}
			}
			if (overlay) {
				const currentLayout = overlay.layout;
				const layout = elementLayout(overlay.node);
				if (!layoutsAreEqual(currentLayout, layout)) {
					draft.active.overlay.layout = layout;
					anyLayoutChanged = true;
				}
			}
		});
		return anyLayoutChanged;
	};
	const detectCollisions = () => {
		const draggable = state.active.overlay ?? state.active.draggable;
		if (draggable) {
			const droppable = props.collisionDetector(draggable, Object.values(state.droppables), { activeDroppableId: state.active.droppableId });
			const droppableId = droppable ? droppable.id : null;
			if (state.active.droppableId !== droppableId) setState((draft) => {
				draft.active.droppableId = droppableId;
			});
		}
	};
	const dragStart = (draggableId) => {
		const transformer = {
			id: "sensorMove",
			order: 0,
			callback: (transform) => {
				if (state.active.sensor) return {
					x: transform.x + state.active.sensor.coordinates.delta.x,
					y: transform.y + state.active.sensor.coordinates.delta.y
				};
				return transform;
			}
		};
		recomputeLayouts();
		setState((draft) => {
			draft.active.draggableId = draggableId;
			updateTransformer(draft.draggables[draggableId].transformers, transformer);
		});
		detectCollisions();
	};
	const dragEnd = () => {
		const draggableId = untrack(() => state.active.draggableId);
		setState((draft) => {
			if (draggableId !== null) delete draft.draggables[draggableId].transformers.sensorMove;
			draft.active.draggableId = null;
			draft.active.droppableId = null;
		});
		recomputeLayouts();
	};
	const onDragStart = (handler) => {
		createEffect(() => state.active.draggable, (draggable) => {
			if (draggable) untrack(() => handler({ draggable }));
		});
	};
	const onDragMove = (handler) => {
		createEffect(() => {
			const draggable = state.active.draggable;
			if (!draggable) return null;
			const overlay = untrack(() => state.active.overlay);
			Object.values(overlay ? overlay.transform : draggable.transform);
			return {
				draggable,
				overlay
			};
		}, (value) => {
			if (value) untrack(() => handler(value));
		});
	};
	const onDragOver = (handler) => {
		createEffect(() => {
			const draggable = state.active.draggable;
			return draggable ? {
				draggable,
				droppable: state.active.droppable,
				overlay: untrack(() => state.active.overlay)
			} : null;
		}, (value) => {
			if (value) untrack(() => handler(value));
		});
	};
	const onDragEnd = (handler) => {
		createEffect(() => {
			const draggable = state.active.draggable;
			return {
				draggable,
				droppable: draggable ? state.active.droppable : null,
				overlay: draggable ? state.active.overlay : null
			};
		}, (current, previous) => {
			if (!current.draggable && previous?.draggable) {
				const event = {
					draggable: previous.draggable,
					droppable: previous.droppable,
					overlay: previous.overlay
				};
				untrack(() => handler(event));
			}
		});
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
	return createComponent(Context$1, {
		value: [state, {
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
			onDragEnd
		}],
		get children() {
			return props.children;
		}
	});
};
const useDragDropContext = () => {
	return useContext(Context$1) || null;
};
//#endregion
//#region src/create-pointer-sensor.ts
const createPointerSensor = (id = "pointer-sensor") => {
	const [state, { addSensor, removeSensor, sensorStart, sensorMove, sensorEnd, dragStart, dragEnd }] = useDragDropContext();
	const activationDelay = 250;
	const activationDistance = 10;
	onSettled(() => {
		addSensor({
			id,
			activators: { pointerdown: attach }
		});
		return () => removeSensor(id);
	});
	const isActiveSensor = () => state.active.sensorId === id;
	const initialCoordinates = {
		x: 0,
		y: 0
	};
	let activationDelayTimeoutId = null;
	let activationDraggableId = null;
	const attach = (event, draggableId) => {
		if (event.button !== 0) return;
		document.addEventListener("pointermove", onPointerMove);
		document.addEventListener("pointerup", onPointerUp);
		activationDraggableId = draggableId;
		initialCoordinates.x = event.clientX;
		initialCoordinates.y = event.clientY;
		activationDelayTimeoutId = window.setTimeout(onActivate, activationDelay);
	};
	const detach = () => {
		if (activationDelayTimeoutId) {
			clearTimeout(activationDelayTimeoutId);
			activationDelayTimeoutId = null;
		}
		document.removeEventListener("pointermove", onPointerMove);
		document.removeEventListener("pointerup", onPointerUp);
		document.removeEventListener("selectionchange", clearSelection);
	};
	const onActivate = () => {
		if (!state.active.sensor) {
			sensorStart(id, initialCoordinates);
			dragStart(activationDraggableId);
			clearSelection();
			document.addEventListener("selectionchange", clearSelection);
		} else if (!isActiveSensor()) detach();
	};
	const onPointerMove = (event) => {
		const coordinates = {
			x: event.clientX,
			y: event.clientY
		};
		if (!state.active.sensor) {
			const transform = {
				x: coordinates.x - initialCoordinates.x,
				y: coordinates.y - initialCoordinates.y
			};
			if (Math.sqrt(transform.x ** 2 + transform.y ** 2) > activationDistance) onActivate();
		}
		if (isActiveSensor()) {
			event.preventDefault();
			sensorMove(coordinates);
		}
	};
	const onPointerUp = (event) => {
		detach();
		if (isActiveSensor()) {
			event.preventDefault();
			dragEnd();
			sensorEnd();
		}
	};
	const clearSelection = () => {
		window.getSelection()?.removeAllRanges();
	};
};
//#endregion
//#region src/drag-drop-sensors.tsx
const DragDropSensors = (props) => {
	createPointerSensor();
	return memo(() => props.children);
};
//#endregion
//#region src/style.ts
const layoutStyle = (layout) => {
	return {
		top: `${layout.y}px`,
		left: `${layout.x}px`,
		width: `${layout.width}px`,
		height: `${layout.height}px`
	};
};
const transformStyle = (transform) => {
	return { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` };
};
const maybeTransformStyle = (transform) => {
	return transformsAreEqual(transform, noopTransform()) ? {} : transformStyle(transform);
};
//#endregion
//#region src/create-draggable.ts
const createDraggable = (id, data = {}) => {
	const [state, { addDraggable, removeDraggable, draggableActivators }] = useDragDropContext();
	const [node, setNode] = createSignal(null);
	const [skipTransform, setSkipTransform] = createSignal(false);
	onSettled(() => {
		const resolvedNode = node();
		if (resolvedNode) addDraggable({
			id,
			node: resolvedNode,
			layout: elementLayout(resolvedNode),
			data
		});
		return () => removeDraggable(id);
	});
	const isActiveDraggable = () => state.active.draggableId === id;
	const transform = () => {
		return state.draggables[id]?.transform || noopTransform();
	};
	createEffect(() => ({
		node: node(),
		activators: draggableActivators(id)
	}), ({ node: resolvedNode, activators }) => {
		if (!resolvedNode) return;
		for (const key in activators) resolvedNode.addEventListener(key, activators[key]);
		return () => {
			for (const key in activators) resolvedNode.removeEventListener(key, activators[key]);
		};
	});
	createEffect(() => {
		const { x, y } = transform();
		return {
			node: node(),
			transform: {
				x,
				y
			},
			skipTransform: skipTransform()
		};
	}, ({ node: resolvedNode, transform: resolvedTransform, skipTransform }) => {
		if (!resolvedNode || skipTransform) return;
		if (!transformsAreEqual(resolvedTransform, noopTransform())) {
			const style = transformStyle(resolvedTransform);
			resolvedNode.style.setProperty("transform", style.transform ?? null);
		} else resolvedNode.style.removeProperty("transform");
		return () => resolvedNode.style.removeProperty("transform");
	});
	return Object.defineProperties((element, accessor) => {
		const config = accessor ? accessor() : {};
		setSkipTransform(Boolean(config.skipTransform));
		setNode(element);
	}, {
		ref: {
			enumerable: true,
			value: setNode
		},
		isActiveDraggable: {
			enumerable: true,
			get: isActiveDraggable
		},
		dragActivators: {
			enumerable: true,
			get: () => {
				return draggableActivators(id, true);
			}
		},
		transform: {
			enumerable: true,
			get: transform
		}
	});
};
//#endregion
//#region src/create-droppable.ts
const createDroppable = (id, data = {}) => {
	return createDroppableWithTransformers(id, data, []);
};
const createDroppableWithTransformers = (id, data, transformers) => {
	const [state, { addDroppable, removeDroppable }] = useDragDropContext();
	const [node, setNode] = createSignal(null);
	const [skipTransform, setSkipTransform] = createSignal(false);
	onSettled(() => {
		const resolvedNode = node();
		if (resolvedNode) {
			const registration = {
				id,
				node: resolvedNode,
				layout: elementLayout(resolvedNode),
				data,
				transformers: Object.fromEntries(transformers.map((transformer) => [transformer.id, transformer]))
			};
			addDroppable(registration);
			return () => removeDroppable(id);
		}
	});
	const isActiveDroppable = () => state.active.droppableId === id;
	const transform = () => {
		return state.droppables[id]?.transform || noopTransform();
	};
	createEffect(() => {
		const { x, y } = transform();
		return {
			node: node(),
			transform: {
				x,
				y
			},
			skipTransform: skipTransform()
		};
	}, ({ node: resolvedNode, transform: resolvedTransform, skipTransform }) => {
		if (!resolvedNode || skipTransform) return;
		if (!transformsAreEqual(resolvedTransform, noopTransform())) {
			const style = transformStyle(resolvedTransform);
			resolvedNode.style.setProperty("transform", style.transform ?? null);
		} else resolvedNode.style.removeProperty("transform");
		return () => resolvedNode.style.removeProperty("transform");
	});
	return Object.defineProperties((element, accessor) => {
		const config = accessor ? accessor() : {};
		setSkipTransform(Boolean(config.skipTransform));
		setNode(element);
	}, {
		ref: {
			enumerable: true,
			value: setNode
		},
		isActiveDroppable: {
			enumerable: true,
			get: isActiveDroppable
		},
		transform: {
			enumerable: true,
			get: transform
		}
	});
};
//#endregion
//#region src/drag-overlay.tsx
var _tmpl$$1 = /*#__PURE__*/ template(`<div>`);
const DragOverlay = (props) => {
	const [state, { onDragStart, onDragEnd, setOverlay, clearOverlay }] = useDragDropContext();
	let node;
	onDragStart(({ draggable }) => {
		setOverlay({
			node: draggable.node,
			layout: draggable.layout
		});
		queueMicrotask(() => {
			if (node) {
				const layout = elementLayout(node);
				const delta = {
					x: (draggable.layout.width - layout.width) / 2,
					y: (draggable.layout.height - layout.height) / 2
				};
				layout.x += delta.x;
				layout.y += delta.y;
				setOverlay({
					node,
					layout
				});
			}
		});
	});
	onDragEnd(() => queueMicrotask(clearOverlay));
	const style$1 = () => {
		const overlay = state.active.overlay;
		const draggable = state.active.draggable;
		if (!overlay || !draggable) return {};
		return {
			position: "fixed",
			transition: "transform 0s",
			top: `${overlay.layout.top}px`,
			left: `${overlay.layout.left}px`,
			"min-width": `${draggable.layout.width}px`,
			"min-height": `${draggable.layout.height}px`,
			...transformStyle(overlay.transform),
			...props.style
		};
	};
	return createComponent(Portal, {
		get mount() {
			return document.body;
		},
		get children() {
			return createComponent(Show, {
				get when() {
					return state.active.draggable;
				},
				get children() {
					var _el$ = getNextElement(_tmpl$$1);
					var _ref$ = node;
					typeof _ref$ === "function" || Array.isArray(_ref$) ? ref(() => _ref$, _el$) : node = _el$;
					insert(_el$, scope((() => {
						var _c$ = memo(() => typeof props.children === "function");
						return () => _c$() ? props.children(state.active.draggable) : props.children;
					})()));
					effect(() => ({
						e: readShallow(props.class),
						t: readShallow(style$1())
					}), ({ e, t }, _p$) => {
						className(_el$, e, _p$?.e);
						style(_el$, t, _p$?.t);
					});
					return _el$;
				}
			});
		}
	});
};
//#endregion
//#region src/sortable-context.tsx
const Context = createContext();
const updateIds = (target, ids) => {
	let changed = target.length !== ids.length;
	for (let index = 0; index < ids.length; index++) if (target[index] !== ids[index]) {
		target[index] = ids[index];
		changed = true;
	}
	if (target.length !== ids.length) target.length = ids.length;
	return changed;
};
const SortableProvider = (props) => {
	const [dndState] = useDragDropContext();
	const [state, setState] = createStore({
		initialIds: [],
		sortedIds: []
	});
	createEffect(() => ({
		draggableId: dndState.active.draggableId,
		droppableId: dndState.active.droppableId,
		ids: [...props.ids]
	}), ({ draggableId, droppableId, ids }) => {
		setState((draft) => {
			const { initialIds, sortedIds } = draft;
			if (updateIds(initialIds, ids)) updateIds(sortedIds, ids);
			if (draggableId === null || droppableId === null) {
				updateIds(sortedIds, ids);
				return;
			}
			const fromIndex = sortedIds.indexOf(draggableId);
			const toIndex = initialIds.indexOf(droppableId);
			const isValidIndex = (index) => index >= 0 && index < initialIds.length && index < sortedIds.length;
			if (!isValidIndex(fromIndex) || !isValidIndex(toIndex)) updateIds(sortedIds, ids);
			else if (fromIndex !== toIndex) {
				const movedId = sortedIds[fromIndex];
				const direction = fromIndex < toIndex ? 1 : -1;
				for (let index = fromIndex; index !== toIndex; index += direction) {
					const nextId = sortedIds[index + direction];
					if (sortedIds[index] !== nextId) sortedIds[index] = nextId;
				}
				if (sortedIds[toIndex] !== movedId) sortedIds[toIndex] = movedId;
			}
		});
	});
	return createComponent(Context, {
		value: [state, {}],
		get children() {
			return props.children;
		}
	});
};
const useSortableContext = () => {
	return useContext(Context) || null;
};
//#endregion
//#region src/create-sortable.ts
const createSortable = (id, data = {}) => {
	const [dndState] = useDragDropContext();
	const [sortableState] = useSortableContext();
	const draggable = createDraggable(id, data);
	const [node, setNode] = createSignal(null);
	const initialIndex = () => sortableState.initialIds.indexOf(id);
	const currentIndex = () => sortableState.sortedIds.indexOf(id);
	const layoutById = (id) => dndState.droppables[id]?.layout || null;
	const sortedTransform = () => {
		const delta = noopTransform();
		const resolvedInitialIndex = initialIndex();
		const resolvedCurrentIndex = currentIndex();
		if (resolvedCurrentIndex !== resolvedInitialIndex) {
			const currentLayout = layoutById(id);
			const targetLayout = layoutById(sortableState.initialIds[resolvedCurrentIndex]);
			if (currentLayout && targetLayout) {
				delta.x = targetLayout.x - currentLayout.x;
				delta.y = targetLayout.y - currentLayout.y;
			}
		}
		return delta;
	};
	const droppable = createDroppableWithTransformers(id, data, [{
		id: "sortableOffset",
		order: 100,
		callback: (transform) => {
			const delta = sortedTransform();
			return {
				x: transform.x + delta.x,
				y: transform.y + delta.y
			};
		}
	}]);
	const setRefs = (element) => {
		draggable.ref(element);
		droppable.ref(element);
		setNode(element);
	};
	const transform = () => {
		return (id === dndState.active.draggableId && !dndState.active.overlay ? dndState.draggables[id]?.transform : dndState.droppables[id]?.transform) || noopTransform();
	};
	createEffect(() => {
		const { x, y } = transform();
		return {
			node: node(),
			transform: {
				x,
				y
			}
		};
	}, ({ node: resolvedNode, transform: resolvedTransform }) => {
		if (!resolvedNode) return;
		if (!transformsAreEqual(resolvedTransform, noopTransform())) {
			const style = transformStyle(resolvedTransform);
			resolvedNode.style.setProperty("transform", style.transform ?? null);
		} else resolvedNode.style.removeProperty("transform");
		return () => resolvedNode.style.removeProperty("transform");
	});
	return Object.defineProperties((element) => {
		draggable(element, () => ({ skipTransform: true }));
		droppable(element, () => ({ skipTransform: true }));
		setNode(element);
	}, {
		ref: {
			enumerable: true,
			value: setRefs
		},
		transform: {
			enumerable: true,
			get: transform
		},
		isActiveDraggable: {
			enumerable: true,
			get: () => draggable.isActiveDraggable
		},
		dragActivators: {
			enumerable: true,
			get: () => draggable.dragActivators
		},
		isActiveDroppable: {
			enumerable: true,
			get: () => droppable.isActiveDroppable
		}
	});
};
//#endregion
//#region src/drag-drop-debugger.tsx
var _tmpl$ = /*#__PURE__*/ template(`<div style="position:fixed;pointer-events:none;outline:1px dashed;display:flex;align-items:flex-end;justify-content:flex-end">`);
const Highlighter = (props) => {
	props = merge({
		color: "red",
		active: false
	}, props);
	var _el$ = getNextElement(_tmpl$);
	insert(_el$, () => props.id);
	effect(() => ({
		...layoutStyle(props.layout),
		"outline-width": props.active ? "4px" : "1px",
		"outline-color": props.color,
		color: props.color,
		...props.style
	}), (_v$, _$p) => {
		style(_el$, _v$, _$p);
	});
	return _el$;
};
const DragDropDebugger = () => {
	const [state, { recomputeLayouts }] = useDragDropContext();
	let ticking = false;
	const update = () => {
		if (!ticking) {
			window.requestAnimationFrame(function() {
				recomputeLayouts();
				ticking = false;
			});
			ticking = true;
		}
	};
	onSettled(() => {
		document.addEventListener("scroll", update);
		return () => document.removeEventListener("scroll", update);
	});
	return createComponent(Portal, {
		get mount() {
			return document.body;
		},
		get children() {
			return [
				createComponent(For, {
					get each() {
						return Object.values(state.droppables);
					},
					children: (droppable) => droppable ? createComponent(Highlighter, {
						get id() {
							return droppable.id;
						},
						get layout() {
							return droppable.layout;
						},
						get active() {
							return droppable.id === state.active.droppableId;
						}
					}) : null
				}),
				createComponent(For, {
					get each() {
						return Object.values(state.draggables);
					},
					children: (draggable) => draggable ? createComponent(Highlighter, {
						get id() {
							return draggable.id;
						},
						get layout() {
							return draggable.layout;
						},
						get active() {
							return draggable.id === state.active.draggableId;
						},
						color: "blue",
						get style() {
							return {
								"align-items": "flex-start",
								"justify-content": "flex-start",
								...transformStyle(draggable.transform)
							};
						}
					}) : null
				}),
				createComponent(Show$1, {
					get when() {
						return state.active.overlay;
					},
					keyed: true,
					children: (overlay) => createComponent(Highlighter, {
						get id() {
							return overlay.id;
						},
						get layout() {
							return overlay.layout;
						},
						active: true,
						color: "orange",
						get style() {
							return { ...transformStyle(overlay.transform) };
						}
					})
				})
			];
		}
	});
};
//#endregion
export { DragDropDebugger, DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter, closestCorners, createDraggable, createDroppable, createPointerSensor, createSortable, layoutStyle, maybeTransformStyle, mostIntersecting, transformStyle, useDragDropContext, useSortableContext };
