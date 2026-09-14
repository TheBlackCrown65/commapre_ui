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
    className = ""
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

    const filteredOptions = options.filter(opt =>
        opt.label.toLowerCase().includes(searchTerm.toLowerCase())
    );

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
                    "w-full min-h-10 flex items-center justify-between border-2 rounded-lg px-2.5 py-1.5 transition-all outline-none text-left gap-2",
                    disabled ? "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed" : "cursor-pointer bg-white focus:border-teal-500 focus:ring-1 focus:ring-teal-500",
                    !disabled && !value ? "border-teal-500 text-teal-600 font-bold shadow-sm" : "",
                    !disabled && value ? "border-teal-500 text-teal-700 font-medium shadow-sm hover:border-teal-600" : ""
                )}
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
            >
                <span
                    className="break-all whitespace-normal text-xs sm:text-sm font-medium leading-snug pr-1 flex-1"
                    title={selectedOption ? selectedOption.label : placeholder}
                >
                    {selectedOption ? selectedOption.label : placeholder}
                </span>
                <ChevronDown size={16} className={clsx("transition-transform shrink-0 self-center", isOpen && "rotate-180")} />
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
                                        <span className="whitespace-nowrap">{highlightedLabel}</span>
                                        {value === opt.value && <Check size={14} className="text-teal-600 shrink-0" />}
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
            value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired
        })
    ),
    value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    onChange: PropTypes.func.isRequired,
    placeholder: PropTypes.string,
    disabled: PropTypes.bool,
    className: PropTypes.string
};
