/* eslint-disable react/prop-types */
import React from 'react';

export default function SkeletonScreen() {
    return (
        <div className="p-3 sm:p-5 lg:p-8 w-full animate-pulse">
            {/* Summary skeleton */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 lg:gap-6 mb-6 lg:mb-8">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="bg-white p-6 rounded-lg shadow-sm border border-slate-200 flex flex-col items-center justify-center h-28">
                        <div className="w-16 h-8 rounded mb-3 animate-shimmer"></div>
                        <div className="w-24 h-3 rounded animate-shimmer" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                ))}
            </div>

            {/* Row skeleton */}
            <div className="space-y-4 sm:space-y-6 lg:space-y-8">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                        <div className="px-3 lg:px-4 py-2.5 lg:py-3 border-b border-slate-100 flex justify-between">
                            <div className="w-1/3 h-4 rounded animate-shimmer"></div>
                            <div className="w-20 h-5 rounded animate-shimmer" style={{ animationDelay: '0.1s' }}></div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
                            {[1, 2, 3].map((j) => (
                                <div key={j} className="p-2 sm:p-3 lg:p-4">
                                    <div className="w-24 h-3 rounded mb-2 animate-shimmer" style={{ animationDelay: `${j * 0.1}s` }}></div>
                                    <div className="aspect-[16/9] rounded flex items-center justify-center border border-slate-100 overflow-hidden">
                                        <div className="w-full h-full animate-shimmer" style={{ animationDelay: `${(i+j) * 0.15}s` }}></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
