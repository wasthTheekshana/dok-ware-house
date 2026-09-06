/// <reference types="jest" />
import { computeEffectivePermissions } from '../utils/permissions';

describe('computeEffectivePermissions', () => {
    it('returns the full permission set for system_admin with no overrides', () => {
        const result = computeEffectivePermissions('system_admin', []);
        expect(result.sort()).toEqual([
            'manage_box_events', 'manage_companies', 'manage_expenses', 'manage_invoices',
            'manage_payroll', 'manage_staff', 'manage_users', 'manage_warehouses', 'view_invoices',
        ].sort());
    });

    it('returns manage_box_events, manage_expenses, manage_staff, and manage_payroll for warehouse_admin with no overrides', () => {
        expect(computeEffectivePermissions('warehouse_admin', []).sort()).toEqual(['manage_box_events', 'manage_expenses', 'manage_staff', 'manage_payroll'].sort());
    });

    it('returns view_invoices, manage_invoices, and manage_payroll for finance_officer with no overrides', () => {
        expect(computeEffectivePermissions('finance_officer', []).sort()).toEqual(['manage_invoices', 'view_invoices', 'manage_payroll'].sort());
    });

    it('returns an empty array for an unrecognized role', () => {
        expect(computeEffectivePermissions('nonsense_role', [])).toEqual([]);
    });

    it('adds a permission via a grant override not in the role default', () => {
        const result = computeEffectivePermissions('warehouse_admin', [{ permission_key: 'view_invoices', granted: true }]);
        expect(result.sort()).toEqual(['manage_box_events', 'manage_expenses', 'manage_staff', 'manage_payroll', 'view_invoices'].sort());
    });

    it('removes a permission via a revoke override that is in the role default', () => {
        const result = computeEffectivePermissions('warehouse_admin', [{ permission_key: 'manage_box_events', granted: false }]);
        expect(result.sort()).toEqual(['manage_expenses', 'manage_staff', 'manage_payroll'].sort());
    });

    it('applies multiple overrides together', () => {
        const result = computeEffectivePermissions('warehouse_admin', [
            { permission_key: 'manage_box_events', granted: false },
            { permission_key: 'view_invoices', granted: true },
        ]);
        expect(result.sort()).toEqual(['manage_expenses', 'manage_staff', 'manage_payroll', 'view_invoices'].sort());
    });
});
