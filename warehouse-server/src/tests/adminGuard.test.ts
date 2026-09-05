/// <reference types="jest" />
import { wouldRemoveLastAdmin } from '../utils/adminGuard';

describe('wouldRemoveLastAdmin', () => {
    it('allows any change to a user who is not currently an active admin', () => {
        expect(wouldRemoveLastAdmin(false, 'warehouse_admin', 'inactive', 0)).toBe(false);
    });

    it('allows a no-op update that keeps the user an active admin', () => {
        expect(wouldRemoveLastAdmin(true, undefined, undefined, 0)).toBe(false);
    });

    it('allows demoting the last active admin when another active admin exists', () => {
        expect(wouldRemoveLastAdmin(true, 'warehouse_admin', undefined, 1)).toBe(false);
    });

    it('allows deactivating the last active admin when another active admin exists', () => {
        expect(wouldRemoveLastAdmin(true, undefined, 'inactive', 1)).toBe(false);
    });

    it('rejects demoting the sole active admin', () => {
        expect(wouldRemoveLastAdmin(true, 'warehouse_admin', undefined, 0)).toBe(true);
    });

    it('rejects deactivating the sole active admin', () => {
        expect(wouldRemoveLastAdmin(true, undefined, 'inactive', 0)).toBe(true);
    });

    it('rejects both demoting and deactivating the sole active admin at once', () => {
        expect(wouldRemoveLastAdmin(true, 'warehouse_admin', 'inactive', 0)).toBe(true);
    });
});
