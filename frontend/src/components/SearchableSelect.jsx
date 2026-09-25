import React, { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import { clsx } from 'clsx';
import { ChevronDown, Search, Check } from 'lucide-react';

export default function SearchableSelect({
    options = [],
    value,
    onChange,
    placeholder = "Select...",
    disabled = false,
    className = "",
    compact = false,
    buttonClassName = ""
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const wrapperRef = useRef(null);

    useEffect(() => {
        function handleClickOutside(event) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setIsOpen(false);
                setSearchTerm('');
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selectedOption = options.find(opt => opt.value === value);

    const filteredOptions = options.filter(opt => {
        const query = searchTerm.toLowerCase();
        const matchLabel = opt.label.toLowerCase().includes(query);
        const matchSublabel = opt.sublabel ? opt.sublabel.toLowerCase().includes(query) : false;
        return matchLabel || matchSublabel;
    });

    return (
        <div ref={wrapperRef} className={clsx("relative", className || "w-full sm:w-[280px]")}>
            <button
                type="button"
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (!disabled) setIsOpen(!isOpen);
                    }
                }}
                className={clsx(
                    "w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 transition-all outline-none text-left gap-2",
                    compact ? "min-h-8 text-xs border border-slate-200" : "min-h-10 text-xs sm:text-sm border-2",
                    disabled ? "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed" : "cursor-pointer bg-white focus:border-teal-500 focus:ring-1 focus:ring-teal-500",
                    !disabled && !compact && !value ? "border-teal-500 text-teal-600 font-bold shadow-sm" : "",
                    !disabled && !compact && value ? "border-teal-500 text-teal-700 font-medium shadow-sm hover:border-teal-600" : "",
                    !disabled && compact && !value ? "border-slate-200 text-slate-400 hover:border-slate-300" : "",
                    !disabled && compact && value ? "border-teal-500 text-teal-700 font-medium bg-teal-50/30" : "",
                    buttonClassName
                )}
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
            >
                <span
                    className="break-all whitespace-normal text-xs sm:text-sm font-medium leading-snug pr-1 flex-1 truncate"
                    title={selectedOption ? selectedOption.label : placeholder}
                >
                    {selectedOption ? selectedOption.label : placeholder}
                </span>
                <ChevronDown size={14} className={clsx("transition-transform shrink-0 self-center text-slate-400", isOpen && "rotate-180")} />
            </button>

            {isOpen && (
                <div className="absolute left-0 z-50 min-w-full w-max max-w-[85vw] sm:max-w-[650px] mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                    <div className="sticky top-0 bg-white p-2 border-b border-slate-100 z-10">
                        <div className="relative">
                            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                            <input
                                type="text"
                                className="w-full pl-8 pr-3 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                                placeholder="Search..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        if (filteredOptions.length > 0) {
                                            onChange(filteredOptions[0].value);
                                            setIsOpen(false);
                                            setSearchTerm('');
                                        }
                                    } else if (e.key === 'Escape') {
                                        e.preventDefault();
                                        setIsOpen(false);
                                        setSearchTerm('');
                                    }
                                }}
                                onClick={(e) => e.stopPropagation()}
                                autoFocus
                            />
                        </div>
                    </div>
                    
                    {filteredOptions.length === 0 ? (
                        <div className="p-3 text-sm text-center text-slate-500 whitespace-nowrap">No results found</div>
                    ) : (
                        <div className="p-1">
                            {filteredOptions.map((opt) => {
                                // Highlight matching text
                                const matchIndex = opt.label.toLowerCase().indexOf(searchTerm.toLowerCase());
                                let highlightedLabel = opt.label;
                                
                                if (searchTerm && matchIndex !== -1) {
                                    const beforeMatch = opt.label.slice(0, matchIndex);
                                    const matchText = opt.label.slice(matchIndex, matchIndex + searchTerm.length);
                                    const afterMatch = opt.label.slice(matchIndex + searchTerm.length);
                                    
                                    highlightedLabel = (
                                        <>
                                            {beforeMatch}
                                            <span className="bg-yellow-200 text-teal-900 font-bold px-0.5 rounded-sm">{matchText}</span>
                                            {afterMatch}
                                        </>
                                    );
                                }

                                return (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        className={clsx(
                                            "w-full flex items-center justify-between gap-4 px-3 py-2 text-sm rounded-md cursor-pointer hover:bg-teal-50 transition-colors focus:outline-none focus:bg-teal-50 text-left",
                                            value === opt.value ? "bg-teal-100 text-teal-800 font-medium" : "text-slate-700"
                                        )}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            onChange(opt.value);
                                            setIsOpen(false);
                                            setSearchTerm('');
                                        }}
                                    >
                                        <div className="flex flex-col min-w-0 pr-2">
                                            <span className="whitespace-nowrap">{highlightedLabel}</span>
                                            {opt.sublabel && (
                                                <span className="text-[11px] text-slate-400 whitespace-nowrap mt-0.5">{opt.sublabel}</span>
                                            )}
                                        </div>
                                        {value === opt.value && <Check size={14} className="text-teal-600 shrink-0 self-center" />}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

SearchableSelect.propTypes = {
    options: PropTypes.arrayOf(
        PropTypes.shape({
            label: PropTypes.string.isRequired,
            value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
            sublabel: PropTypes.string
        })
    ),
    value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    onChange: PropTypes.func.isRequired,
    placeholder: PropTypes.string,
    disabled: PropTypes.bool,
    className: PropTypes.string,
    compact: PropTypes.bool,
    buttonClassName: PropTypes.string
};
