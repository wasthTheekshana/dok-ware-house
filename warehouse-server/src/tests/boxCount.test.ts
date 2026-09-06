/// <reference types="jest" />
import { applyBoxEvent, eventDelta } from '../utils/boxCount';

describe('applyBoxEvent', () => {
    it('increases the count for an archived event', () => {
        expect(applyBoxEvent(100, 'archived', 25)).toBe(125);
    });

    it('decreases the count for a retrieved event', () => {
        expect(applyBoxEvent(100, 'retrieved', 30)).toBe(70);
    });

    it('leaves the count unchanged for an empty_carton_issued event', () => {
        expect(applyBoxEvent(100, 'empty_carton_issued', 10)).toBe(100);
    });

    it('allows a retrieved event that exactly empties the count', () => {
        expect(applyBoxEvent(50, 'retrieved', 50)).toBe(0);
    });

    it('throws when a retrieved event would take the count negative', () => {
        expect(() => applyBoxEvent(10, 'retrieved', 11)).toThrow('Insufficient boxes');
    });

    it('decreases the count for a disposed event', () => {
        expect(applyBoxEvent(100, 'disposed', 40)).toBe(60);
    });

    it('allows a disposed event that exactly empties the count', () => {
        expect(applyBoxEvent(50, 'disposed', 50)).toBe(0);
    });

    it('throws when a disposed event would take the count negative', () => {
        expect(() => applyBoxEvent(10, 'disposed', 11)).toThrow('Insufficient boxes');
    });
});

describe('eventDelta', () => {
    it('returns a positive delta for an archived event', () => {
        expect(eventDelta('archived', 25)).toBe(25);
    });

    it('returns a negative delta for a retrieved event', () => {
        expect(eventDelta('retrieved', 30)).toBe(-30);
    });

    it('returns zero delta for an empty_carton_issued event', () => {
        expect(eventDelta('empty_carton_issued', 10)).toBe(0);
    });

    it('returns a negative delta for a disposed event', () => {
        expect(eventDelta('disposed', 40)).toBe(-40);
    });
});
