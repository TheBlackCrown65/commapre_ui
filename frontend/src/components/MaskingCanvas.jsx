/* eslint-disable react/prop-types */
import { useState, useRef, useEffect } from 'react';
import { X, Trash2 } from 'lucide-react';
import clsx from 'clsx';

export default function MaskingCanvas({
    imageUrl,
    masks = [],
    onMaskAdd,
    onMaskUpdate,
    onMaskDelete,
    mode = 'GLOBAL'
}) {
    const containerRef = useRef(null);
    const imgRef = useRef(null);
    const lastClientPos = useRef({ x: 0, y: 0 });
    const [isDrawing, setIsDrawing] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const [resizeHandle, setResizeHandle] = useState(null);
    const [resizingMask, setResizingMask] = useState(null);
    const [resizeStartPos, setResizeStartPos] = useState({ x: 0, y: 0 });

    const [startPos, setStartPos] = useState({ x: 0, y: 0 });
    const [currentRect, setCurrentRect] = useState(null);
    const [scale, setScale] = useState({ x: 1, y: 1 });

    const [imgSize, setImgSize] = useState({ width: 0, height: 0 });
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
    const [showZoom, setShowZoom] = useState(false);
    const [previewRect, setPreviewRect] = useState({ top: 0, left: 0 });
    const [imgLoading, setImgLoading] = useState(true);

    useEffect(() => {
        setImgLoading(true);
    }, [imageUrl]);

    const ZOOM_LEVEL = 2;
    const LENS_SIZE = 420;

    const blackCrosshairCursor = `url("data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M12 0V24M0 12H24' stroke='black' stroke-width='1'/%3E%3C/svg%3E") 12 12, crosshair`;

    const updateScale = () => {
        if (imgRef.current) {
            const { naturalWidth, width, naturalHeight, height } = imgRef.current;
            if (width > 0 && height > 0) {
                setScale({
                    x: naturalWidth / width,
                    y: naturalHeight / height
                });
                setImgSize({ width, height });
            }
        }
    };

    const updatePreviewPosition = () => {
        if (imgRef.current && containerRef.current) {
            const imgRect = imgRef.current.getBoundingClientRect();
            const sidebar = document.getElementById('settings-sidebar') || document.querySelector('.w-[420px]') || document.querySelector('.w-80');
            const sidebarRect = sidebar ? sidebar.getBoundingClientRect() : null;

            // 🟢 Find the coordinates of the parent container that acts as a scroll area
            const scrollArea = containerRef.current.closest('.overflow-auto');
            const scrollRect = scrollArea ? scrollArea.getBoundingClientRect() : null;

            // 🟢 Formula to lock Y coordinate: Prevent magnifying glass from floating up along the image when scrolling
            // (+16 is the container padding to align perfectly with image edge initially)
            const fixedTop = scrollRect
                ? Math.max(scrollRect.top + 16, imgRect.top)
                : Math.max(90, imgRect.top);

            setPreviewRect({
                top: fixedTop,
                left: (sidebarRect ? sidebarRect.right : 420) - LENS_SIZE
            });
        }
    };

    useEffect(() => {
        window.addEventListener('resize', updateScale);

        // ResizeObserver: recalc scale when container resizes (e.g. sidebar toggle)
        let resizeObserver;
        if (containerRef.current) {
            resizeObserver = new ResizeObserver(() => {
                updateScale();
            });
            resizeObserver.observe(containerRef.current);
        }

        return () => {
            window.removeEventListener('resize', updateScale);
            if (resizeObserver) resizeObserver.disconnect();
        };
    }, []);

    // Listen for scroll on parent container to update zoom preview in real-time
    useEffect(() => {
        const scrollArea = containerRef.current?.closest('.overflow-auto');
        if (!scrollArea) return;

        const onScroll = () => {
            if (imgRef.current && lastClientPos.current) {
                const rect = imgRef.current.getBoundingClientRect();
                setMousePos({
                    x: lastClientPos.current.x - rect.left,
                    y: lastClientPos.current.y - rect.top
                });
            }
            updatePreviewPosition();
        };

        scrollArea.addEventListener('scroll', onScroll, { passive: true });
        return () => scrollArea.removeEventListener('scroll', onScroll);
    }, [imageUrl]);

    useEffect(() => {
        const handleContext = (e) => {
            if (containerRef.current && containerRef.current.contains(e.target)) {
                e.preventDefault();
            }
        };
        document.addEventListener('contextmenu', handleContext);
        return () => document.removeEventListener('contextmenu', handleContext);
    }, []);

    // Global mouse events for drawing and resizing outside container
    useEffect(() => {
        if (!isDrawing && !isResizing) return;

        const onGlobalMouseMove = (e) => {
            lastClientPos.current = { x: e.clientX, y: e.clientY };
            handleMouseMove(e);
        };
        const onGlobalMouseUp = (e) => {
            handleMouseUp();
        };

        window.addEventListener('mousemove', onGlobalMouseMove);
        window.addEventListener('mouseup', onGlobalMouseUp);
        return () => {
            window.removeEventListener('mousemove', onGlobalMouseMove);
            window.removeEventListener('mouseup', onGlobalMouseUp);
        };
    }, [isDrawing, isResizing, currentRect, startPos, resizeStartPos, resizingMask, resizeHandle]);

    if (!imageUrl) {
        return (
            <div className="w-full h-96 bg-slate-100 border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center text-slate-400">
                <p>No Reference Image Selected</p>
                <p className="text-sm">Upload a page image to start masking</p>
            </div>
        );
    }

    const getRelativePos = (e) => {
        if (!imgRef.current) return { x: 0, y: 0 };
        const rect = imgRef.current.getBoundingClientRect();
        let x = e.clientX - rect.left;
        let y = e.clientY - rect.top;
        if (x < 0) x = 0;
        if (x > rect.width) x = rect.width;
        if (y < 0) y = 0;
        if (y > rect.height) y = rect.height;
        return { x, y };
    };

    const handleMouseEnter = () => {
        setShowZoom(true);
        updatePreviewPosition();
    };

    const handleMouseDown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();

        const pos = getRelativePos(e);
        setStartPos(pos);
        setMousePos(pos);
        setIsDrawing(true);
        setCurrentRect({ x: pos.x, y: pos.y, width: 0, height: 0 });
    };

    const handleMouseMove = (e) => {
        const pos = getRelativePos(e);
        setMousePos(pos);
        updatePreviewPosition();

        if (isDrawing) {
            const width = pos.x - startPos.x;
            const height = pos.y - startPos.y;

            setCurrentRect({
                x: width > 0 ? startPos.x : pos.x,
                y: height > 0 ? startPos.y : pos.y,
                width: Math.abs(width),
                height: Math.abs(height)
            });
        } else if (isResizing && resizingMask) {
            let newX = resizingMask.x;
            let newY = resizingMask.y;
            let newW = resizingMask.width;
            let newH = resizingMask.height;

            const dx = pos.x - resizeStartPos.x;
            const dy = pos.y - resizeStartPos.y;

            if (resizeHandle.includes('w')) {
                newW = resizingMask.width - dx;
                newX = resizingMask.x + dx;
            }
            if (resizeHandle.includes('e')) {
                newW = resizingMask.width + dx;
            }
            if (resizeHandle.includes('n')) {
                newH = resizingMask.height - dy;
                newY = resizingMask.y + dy;
            }
            if (resizeHandle.includes('s')) {
                newH = resizingMask.height + dy;
            }

            if (newW < 0) { newX += newW; newW = Math.abs(newW); }
            if (newH < 0) { newY += newH; newH = Math.abs(newH); }

            setCurrentRect({ x: newX, y: newY, width: newW, height: newH });
        }
    };

    const handleMouseUp = () => {
        if (isDrawing) {
            setIsDrawing(false);
            if (currentRect && currentRect.width > 5 && currentRect.height > 5) {
                onMaskAdd({
                    x: Math.round(currentRect.x * scale.x),
                    y: Math.round(currentRect.y * scale.y),
                    width: Math.round(currentRect.width * scale.x),
                    height: Math.round(currentRect.height * scale.y),
                    type: mode
                });
            }
            setCurrentRect(null);
        } else if (isResizing) {
            setIsResizing(false);
            if (currentRect && currentRect.width > 5 && currentRect.height > 5) {
                if (onMaskUpdate) {
                    onMaskUpdate({
                        ...resizingMask.raw,
                        x: Math.round(currentRect.x * scale.x),
                        y: Math.round(currentRect.y * scale.y),
                        width: Math.round(currentRect.width * scale.x),
                        height: Math.round(currentRect.height * scale.y)
                    });
                }
            }
            setCurrentRect(null);
            setResizingMask(null);
        }
    };


    const handleMouseMoveWrapped = (e) => {
        lastClientPos.current = { x: e.clientX, y: e.clientY };
        handleMouseMove(e);
    };

    const handleWheel = () => {
        // After scroll, recalc mousePos using stored client coords since image rect shifts
        requestAnimationFrame(() => {
            if (imgRef.current) {
                const rect = imgRef.current.getBoundingClientRect();
                const newPos = {
                    x: lastClientPos.current.x - rect.left,
                    y: lastClientPos.current.y - rect.top
                };
                setMousePos(newPos);
            }
            updatePreviewPosition();
        });
    };

    const bgPosX = (LENS_SIZE / 2) - (mousePos.x * ZOOM_LEVEL);
    const bgPosY = (LENS_SIZE / 2) - (mousePos.y * ZOOM_LEVEL);

    return (
        <div // NOSONAR
            ref={containerRef}
            className="relative inline-block self-start overflow-hidden user-select-none shadow-lg border border-slate-200 rounded-lg bg-slate-50"
            style={{ cursor: blackCrosshairCursor }}
            onMouseEnter={handleMouseEnter} // NOSONAR
            onMouseLeave={() => { // NOSONAR
                setShowZoom(false);
                handleMouseUp();
            }}
            onMouseDown={handleMouseDown} // NOSONAR
            onMouseMove={handleMouseMoveWrapped} // NOSONAR
            onMouseUp={handleMouseUp} // NOSONAR
            onWheel={handleWheel} // NOSONAR
        >
            {imgLoading && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm transition-opacity duration-300">
                    <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin mb-4" />
                    <p className="text-slate-500 font-medium animate-pulse">Loading Reference Image...</p>
                </div>
            )}

            <img
                ref={imgRef}
                key={imageUrl} // Force re-render on URL change
                src={imageUrl}
                alt="Reference"
                className={clsx(
                    "block max-w-full h-auto pointer-events-none select-none transition-all duration-500",
                    imgLoading ? "opacity-0 scale-95" : "opacity-100 scale-100"
                )}
                draggable={false}
                onLoad={() => {
                    setImgLoading(false);
                    updateScale();
                    updatePreviewPosition();
                }}
                onError={() => {
                    setImgLoading(false);
                    console.error("Failed to load image:", imageUrl);
                }}
            />

            {masks.map((mask, idx) => {
                const screenX = mask.x / scale.x;
                const screenY = mask.y / scale.y;
                const screenW = mask.width / scale.x;
                const screenH = mask.height / scale.y;

                return (
                    <div // NOSONAR
                        key={mask.id || idx}
                        className={clsx(
                            "absolute border-2 transition-all duration-200 group hover:bg-opacity-20 hover:bg-white z-10",
                            mask.type === 'GLOBAL' ? "border-red-500 bg-red-500/10" : "border-blue-500 bg-blue-500/10"
                        )}
                        style={{ left: screenX, top: screenY, width: screenW, height: screenH }}
                        onMouseDown={(e) => { // NOSONAR
                            e.stopPropagation();
                            e.preventDefault();
                        }}
                        onContextMenu={(e) => { // NOSONAR
                            e.preventDefault();
                            e.stopPropagation();
                            if (onMaskDelete) onMaskDelete(mask);
                        }}
                    >
                        <div className="absolute -top-6 left-0 bg-slate-800 text-white text-[10px] px-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none">
                            {Math.round(mask.width)}x{Math.round(mask.height)} | {mask.type}
                        </div>
                        
                        {/* Resize Handles */}
                        {!isDrawing && !isResizing && ['nw', 'ne', 'sw', 'se'].map(handle => (
                            <div // NOSONAR
                                key={handle}
                                onMouseDown={(e) => { // NOSONAR
                                    e.stopPropagation();
                                    e.preventDefault();
                                    const pos = getRelativePos(e);
                                    setResizeStartPos(pos);
                                    setIsResizing(true);
                                    setResizeHandle(handle);
                                    setResizingMask({ raw: mask, width: screenW, height: screenH, x: screenX, y: screenY });
                                    setCurrentRect({ x: screenX, y: screenY, width: screenW, height: screenH });
                                }}
                                className={`absolute w-3 h-3 bg-white border border-slate-500 rounded-full z-20 cursor-${handle}-resize opacity-0 group-hover:opacity-100 transition-opacity`}
                                style={{
                                    top: handle.includes('n') ? -6 : 'auto',
                                    bottom: handle.includes('s') ? -6 : 'auto',
                                    left: handle.includes('w') ? -6 : 'auto',
                                    right: handle.includes('e') ? -6 : 'auto',
                                }}
                            />
                        ))}
                    </div>
                );
            })}

            {currentRect && (
                <div
                    className={clsx(
                        "absolute border-2 border-dashed z-20 pointer-events-none",
                        mode === 'GLOBAL' ? "border-red-400 bg-red-400/20" : "border-blue-400 bg-blue-400/20"
                    )}
                    style={{ left: currentRect.x, top: currentRect.y, width: currentRect.width, height: currentRect.height }}
                />
            )}

            {/* FIXED ZOOM PREVIEW */}
            {showZoom && imgSize.width > 0 && (
                <div
                    className="fixed z-[9999] rounded-xl border-2 border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.5)] pointer-events-none bg-slate-100 overflow-hidden"
                    style={{
                        width: LENS_SIZE,
                        height: LENS_SIZE,
                        top: `${previewRect.top}px`,
                        left: `${previewRect.left}px`,
                        backgroundImage: `url("${imageUrl}")`,
                        backgroundRepeat: 'no-repeat',
                        backgroundSize: `${imgSize.width * ZOOM_LEVEL}px ${imgSize.height * ZOOM_LEVEL}px`,
                        backgroundPosition: `${bgPosX}px ${bgPosY}px`
                    }}
                >
                    {masks.map((mask, idx) => {
                        const screenX = mask.x / scale.x;
                        const screenY = mask.y / scale.y;
                        const screenW = mask.width / scale.x;
                        const screenH = mask.height / scale.y;

                        return (
                            <div
                                key={`lens-mask-${idx}`}
                                className={clsx(
                                    "absolute border-2 pointer-events-none",
                                    mask.type === 'GLOBAL' ? "border-red-500 bg-red-500/20" : "border-blue-500 bg-blue-500/20"
                                )}
                                style={{
                                    left: bgPosX + (screenX * ZOOM_LEVEL),
                                    top: bgPosY + (screenY * ZOOM_LEVEL),
                                    width: screenW * ZOOM_LEVEL,
                                    height: screenH * ZOOM_LEVEL
                                }}
                            />
                        );
                    })}

                    {currentRect && (
                        <div
                            className={clsx(
                                "absolute border-2 border-dashed pointer-events-none",
                                mode === 'GLOBAL' ? "border-red-400 bg-red-400/30" : "border-blue-400 bg-blue-400/30"
                            )}
                            style={{
                                left: bgPosX + (currentRect.x * ZOOM_LEVEL),
                                top: bgPosY + (currentRect.y * ZOOM_LEVEL),
                                width: currentRect.width * ZOOM_LEVEL,
                                height: currentRect.height * ZOOM_LEVEL
                            }}
                        />
                    )}

                    <div className="absolute top-1/2 left-0 w-full h-[1px] bg-red-500/80 pointer-events-none" style={{ transform: 'translateY(-50%)' }}></div>
                    <div className="absolute left-1/2 top-0 w-[1px] h-full bg-red-500/80 pointer-events-none" style={{ transform: 'translateX(-50%)' }}></div>
                </div>
            )}
        </div>
    );
}