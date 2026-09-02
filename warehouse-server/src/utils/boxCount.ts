export type BoxEventType = 'archived' | 'retrieved' | 'empty_carton_issued';

export function applyBoxEvent(currentCount: number, eventType: BoxEventType, quantity: number): number {
    switch (eventType) {
        case 'archived':
            return currentCount + quantity;
        case 'retrieved': {
            const next = currentCount - quantity;
            if (next < 0) {
                throw new Error(`Insufficient boxes: department has ${currentCount}, cannot retrieve ${quantity}`);
            }
            return next;
        }
        case 'empty_carton_issued':
            return currentCount;
    }
}

export function eventDelta(eventType: BoxEventType, quantity: number): number {
    switch (eventType) {
        case 'archived':
            return quantity;
        case 'retrieved':
            return -quantity;
        case 'empty_carton_issued':
            return 0;
    }
}
