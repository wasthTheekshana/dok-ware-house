export function wouldRemoveLastAdmin(
    targetIsCurrentlyActiveAdmin: boolean,
    newRole: string | undefined,
    newStatus: string | undefined,
    otherActiveAdminCount: number
): boolean {
    if (!targetIsCurrentlyActiveAdmin) return false;
    const staysAdmin = newRole === undefined || newRole === 'admin';
    const staysActive = newStatus === undefined || newStatus === 'active';
    if (staysAdmin && staysActive) return false;
    return otherActiveAdminCount === 0;
}
