import React from 'react';
import type { LucideIcon } from 'lucide-react';

export type StatCardAccent = 'brand' | 'sky' | 'green' | 'amber';

const ACCENT_STYLES: Record<Exclude<StatCardAccent, 'brand'>, { border: string; iconBg: string; trend: string }> = {
    sky: { border: 'border-l-4 border-sky-500', iconBg: 'bg-sky-100', trend: 'text-sky-600' },
    green: { border: 'border-l-4 border-emerald-600', iconBg: 'bg-emerald-100', trend: 'text-emerald-600' },
    amber: { border: 'border-l-4 border-amber-500', iconBg: 'bg-amber-100', trend: 'text-amber-600' },
};

interface StatCardProps {
    label: string;
    value: string;
    icon: LucideIcon;
    accent: StatCardAccent;
    trend?: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, icon: Icon, accent, trend }) => {
    if (accent === 'brand') {
        return (
            <div className="rounded-card shadow-soft p-4 text-white bg-gradient-to-br from-brand-600 to-brand-500">
                <div className="flex items-start justify-between">
                    <div className="text-xs font-semibold opacity-85 uppercase tracking-wide">{label}</div>
                    <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                        <Icon size={16} />
                    </div>
                </div>
                <div className="text-2xl font-extrabold mt-2">{value}</div>
                {trend && <div className="text-xs opacity-90 font-semibold mt-1">{trend}</div>}
            </div>
        );
    }

    const styles = ACCENT_STYLES[accent];
    return (
        <div className={`bg-white rounded-card shadow-soft p-4 ${styles.border}`}>
            <div className="flex items-start justify-between">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</div>
                <div className={`w-8 h-8 rounded-lg ${styles.iconBg} flex items-center justify-center`}>
                    <Icon size={16} />
                </div>
            </div>
            <div className="text-2xl font-extrabold text-slate-800 mt-2">{value}</div>
            {trend && <div className={`text-xs font-semibold mt-1 ${styles.trend}`}>{trend}</div>}
        </div>
    );
};

export default StatCard;
