/* eslint-disable react/prop-types */
import { ChevronRight, Home } from 'lucide-react';

/**
 * Breadcrumb navigation component
 *
 * Props:
 *  - items: array of { id, name, type } — ordered root → current
 *  - onNavigate: (item) => void
 */
export default function Breadcrumb({ items = [], onNavigate }) {
    if (items.length === 0) return null;

    return (
        <nav className="flex items-center gap-1 text-xs text-slate-500 px-4 py-2 bg-slate-50/80 border-b border-slate-100 overflow-x-auto">
            <button
                onClick={() => onNavigate?.(null)}
                className="flex items-center gap-1 hover:text-blue-600 transition-colors shrink-0"
            >
                <Home size={12} />
                <span>Root</span>
            </button>

            {items.map((item, idx) => (
                <span key={item.id} className="flex items-center gap-1 shrink-0">
                    <ChevronRight size={12} className="text-slate-300" />
                    <button
                        onClick={() => onNavigate?.(item)}
                        className={`hover:text-blue-600 transition-colors truncate max-w-[120px] ${idx === items.length - 1 ? 'text-slate-700 font-medium' : ''
                            }`}
                        title={item.name}
                    >
                        {item.name}
                    </button>
                </span>
            ))}
        </nav>
    );
}
