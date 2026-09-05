/// <reference types="jest" />
import { computeEffectivePermissions } from '../utils/permissions';

describe('computeEffectivePermissions', () => {
    it('returns the full permission set for system_admin with no overrides', () => {
        const result = computeEffectivePermissions('system_admin', []);
        expect(result.sort()).toEqual([
            'manage_box_events', 'manage_companies', 'manage_invoices',
            'manage_users', 'manage_warehouses', 'view_invoices',
        ].sort());
    });

    it('returns only manage_box_events for warehouse_admin with no overrides', () => {
        expect(computeEffectivePermissions('warehouse_admin', [])).toEqual(['manage_box_events']);
    });

    it('returns view_invoices and manage_invoices for finance_officer with no overrides', () => {
        expect(computeEffectivePermissions('finance_officer', []).sort()).toEqual(['manage_invoices', 'view_invoices'].sort());
    });

    it('returns an empty array for an unrecognized role', () => {
        expect(computeEffectivePermissions('nonsense_role', [])).toEqual([]);
    });

    it('adds a permission via a grant override not in the role default', () => {
        const result = computeEffectivePermissions('warehouse_admin', [{ permission_key: 'view_invoices', granted: true }]);
        expect(result.sort()).toEqual(['manage_box_events', 'view_invoices'].sort());
    });

    it('removes a permission via a revoke override that is in the role default', () => {
        const result = computeEffectivePermissions('warehouse_admin', [{ permission_key: 'manage_box_events', granted: false }]);
        expect(result).toEqual([]);
    });

    it('applies multiple overrides together', () => {
        const result = computeEffectivePermissions('warehouse_admin', [
            { permission_key: 'manage_box_events', granted: false },
            { permission_key: 'view_invoices', granted: true },
        ]);
        expect(result).toEqual(['view_invoices']);
    });
});
