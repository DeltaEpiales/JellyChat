import React, { useRef, useEffect, useState, useCallback } from 'react';
import { X, Eraser, PenTool, Download, Trash2, Plus, Play, Square, ChevronLeft, ChevronRight, MousePointer2, Highlighter, Undo2, Redo2 } from 'lucide-react';
import { Socket } from 'socket.io-client';

interface Point {
    x: number;
    y: number;
}

interface DrawData {
    frameIndex: number;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    color: string;
    thickness: number;
    strokeId: string;
    isEraser?: boolean;
    isMarker?: boolean;
}

const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 55%)`;
};

interface PointerData {
    socketId: string;
    ip: string;
    name: string;
    x: number; // 0 to 1 relative
    y: number; // 0 to 1 relative
    lastUpdate: number;
}

interface CollaborativeWorkspaceProps {
    socket: Socket;
    onClose: () => void;
    roomId: string;
}

export function CollaborativeWorkspace({ socket, onClose, roomId }: CollaborativeWorkspaceProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [color, setColor] = useState('#f43f5e'); // Rose 500
    const [thickness, setThickness] = useState(2);
    const [isEraser, setIsEraser] = useState(false);
    const [isMarker, setIsMarker] = useState(false);
    
    // Undo / Redo state
    const currentStrokeId = useRef<string>('');
    const [myStrokeHistory, setMyStrokeHistory] = useState<string[]>([]);
    // Track removed strokes for redo: array of objects containing the stroke segments
    const [undoneStrokes, setUndoneStrokes] = useState<{id: string, segments: DrawData[]}[]>([]);
    
    // Animation & Frames state
    const [frames, setFrames] = useState<DrawData[][]>([[]]);
    const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const framesRef = useRef<DrawData[][]>([[]]);
    const currentFrameRef = useRef(0);
    
    // Virtual pointers
    const [pointers, setPointers] = useState<Record<string, PointerData>>({});
    
    // Store the last drawn point
    const currentPoint = useRef<Point>({ x: 0, y: 0 });
    const pointerEmitThrottle = useRef<number>(0);



    const redrawFrame = useCallback((frameIdx: number) => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const frameData = framesRef.current[frameIdx] || [];
        frameData.forEach(stroke => {
            ctx.beginPath();
            ctx.moveTo(stroke.x0 * canvas.width, stroke.y0 * canvas.height);
            ctx.lineTo(stroke.x1 * canvas.width, stroke.y1 * canvas.height);
            ctx.strokeStyle = stroke.color;
            ctx.lineWidth = stroke.thickness;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            if (stroke.isEraser) {
                ctx.globalCompositeOperation = 'destination-out';
                ctx.strokeStyle = 'rgba(0,0,0,1)';
            } else if (stroke.isMarker) {
                ctx.globalCompositeOperation = 'source-over';
                // Marker uses same color but transparent and thicker
            } else {
                ctx.globalCompositeOperation = 'source-over';
            }
            ctx.stroke();
            ctx.closePath();
        });
        ctx.globalCompositeOperation = 'source-over';
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        // Set fixed internal resolution
        canvas.width = 1920;
        canvas.height = 1080;
        
        const handleResize = () => redrawFrame(currentFrameRef.current);
        window.addEventListener('resize', handleResize);
        
        socket.emit('join_workspace', roomId);

        const handleDraw = (data: DrawData) => {
            // Add stroke to the correct frame
            const newFrames = [...framesRef.current];
            while (newFrames.length <= data.frameIndex) {
                newFrames.push([]);
            }
            newFrames[data.frameIndex] = [...newFrames[data.frameIndex], data];
            framesRef.current = newFrames;
            setFrames(newFrames);
            
            // If it's the current frame, we can just draw the new stroke immediately
            if (data.frameIndex === currentFrameRef.current) {
                if (!canvasRef.current) return;
                const ctx = canvasRef.current.getContext('2d');
                if (!ctx) return;
                const w = canvasRef.current.width;
                const h = canvasRef.current.height;
                
                ctx.beginPath();
                ctx.moveTo(data.x0 * w, data.y0 * h);
                ctx.lineTo(data.x1 * w, data.y1 * h);
                ctx.strokeStyle = data.color;
                ctx.lineWidth = data.thickness;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                if (data.isEraser) {
                    ctx.globalCompositeOperation = 'destination-out';
                    ctx.strokeStyle = 'rgba(0,0,0,1)';
                } else {
                    ctx.globalCompositeOperation = 'source-over';
                }
                ctx.stroke();
                ctx.closePath();
                ctx.globalCompositeOperation = 'source-over';
            }
        };
        
        const handleUndo = ({ strokeId }: { strokeId: string }) => {
            const newFrames = framesRef.current.map(frame => frame.filter(s => s.strokeId !== strokeId));
            framesRef.current = newFrames;
            setFrames(newFrames);
            redrawFrame(currentFrameRef.current);
        };
        
        const handleClear = () => {
            framesRef.current = [[]];
            currentFrameRef.current = 0;
            setFrames([[]]);
            setCurrentFrameIndex(0);
            redrawFrame(0);
        };
        
        const handlePointer = (data: PointerData) => {
            setPointers(prev => ({
                ...prev,
                [data.socketId]: { ...data, lastUpdate: Date.now() }
            }));
        };
        
        const handleFrameChange = (data: { frameIndex: number }) => {
            if (currentFrameRef.current !== data.frameIndex && data.frameIndex < framesRef.current.length) {
                currentFrameRef.current = data.frameIndex;
                setCurrentFrameIndex(data.frameIndex);
                redrawFrame(data.frameIndex);
            }
        };

        socket.on('workspace_draw_receive', handleDraw);
        socket.on('workspace_undo_receive', handleUndo);
        socket.on('workspace_clear_receive', handleClear);
        socket.on('workspace_pointer_receive', handlePointer);
        socket.on('workspace_frame_change_receive', handleFrameChange);

        // Pointer cleanup interval
        const cleanupInterval = setInterval(() => {
            const now = Date.now();
            setPointers(prev => {
                const updated = { ...prev };
                let changed = false;
                for (const sid in updated) {
                    if (now - updated[sid].lastUpdate > 3000) {
                        delete updated[sid];
                        changed = true;
                    }
                }
                return changed ? updated : prev;
            });
        }, 1000);

        return () => {
            window.removeEventListener('resize', handleResize);
            socket.off('workspace_draw_receive', handleDraw);
            socket.off('workspace_clear_receive', handleClear);
            socket.off('workspace_pointer_receive', handlePointer);
            socket.off('workspace_frame_change_receive', handleFrameChange);
            clearInterval(cleanupInterval);
        };
    }, [socket, redrawFrame]);
    
    // Animation loop
    useEffect(() => {
        if (!isPlaying) return;
        
        const interval = setInterval(() => {
            let nextIdx = currentFrameRef.current + 1;
            if (nextIdx >= framesRef.current.length) nextIdx = 0;
            
            currentFrameRef.current = nextIdx;
            setCurrentFrameIndex(nextIdx);
            redrawFrame(nextIdx);
        }, 200); // 5 fps for flipnote style
        
        return () => clearInterval(interval);
    }, [isPlaying, redrawFrame]);

    const drawLine = (ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, strokeColor: string, strokeWidth: number, emit: boolean, isEraser?: boolean, isMarker?: boolean) => {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (isEraser) {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = 'rgba(0,0,0,1)';
        } else {
            ctx.globalCompositeOperation = 'source-over';
        }
        ctx.stroke();
        ctx.closePath();
        ctx.globalCompositeOperation = 'source-over';

        if (!emit) return;

        const w = canvasRef.current?.width || 1;
        const h = canvasRef.current?.height || 1;

        const strokeData: DrawData = {
            frameIndex: currentFrameRef.current,
            x0: x0 / w,
            y0: y0 / h,
            x1: x1 / w,
            y1: y1 / h,
            color: strokeColor,
            thickness: strokeWidth,
            strokeId: currentStrokeId.current,
            isEraser,
            isMarker
        };
        
        // Add locally
        const newFrames = [...framesRef.current];
        newFrames[currentFrameRef.current] = [...newFrames[currentFrameRef.current], strokeData];
        framesRef.current = newFrames;
        setFrames(newFrames);

        // Emit
        socket.emit('workspace_draw', {
            room: roomId,
            data: strokeData
        });
    };

    const emitPointer = (x: number, y: number) => {
        const now = Date.now();
        if (now - pointerEmitThrottle.current < 50) return; // throttle to ~20hz
        pointerEmitThrottle.current = now;
        
        const w = canvasRef.current?.width || 1;
        const h = canvasRef.current?.height || 1;
        
        socket.emit('workspace_pointer', {
            room: roomId,
            data: { x: x / w, y: y / h }
        });
    };

    const getCoordinates = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent): Point => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        
        const rect = canvas.getBoundingClientRect();
        
        let clientX, clientY;
        if ('touches' in e) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = (e as React.MouseEvent).clientX;
            clientY = (e as React.MouseEvent).clientY;
        }

        // Scale from CSS pixels to fixed internal 1920x1080 resolution
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    };

    const onMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
        if (isPlaying) setIsPlaying(false);
        setIsDrawing(true);
        currentStrokeId.current = Math.random().toString(36).substring(2, 9);
        currentPoint.current = getCoordinates(e);
        emitPointer(currentPoint.current.x, currentPoint.current.y);
    };

    const onMouseUp = () => {
        if (isDrawing && currentStrokeId.current) {
            setMyStrokeHistory(prev => [...prev, currentStrokeId.current]);
            setUndoneStrokes([]);
        }
        setIsDrawing(false);
    };

    const onMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
        const newPoint = getCoordinates(e);
        emitPointer(newPoint.x, newPoint.y);
        
        if (!isDrawing || !canvasRef.current) return;
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;
        
        let strokeColor = isEraser ? '#18181b' : color;
        let strokeWidth = isEraser ? thickness * 5 : thickness;
        
        if (isMarker) {
            strokeWidth = thickness * 3;
            // append alpha
            const hexMatch = color.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
            if (hexMatch) {
                strokeColor = `rgba(${parseInt(hexMatch[1], 16)}, ${parseInt(hexMatch[2], 16)}, ${parseInt(hexMatch[3], 16)}, 0.15)`;
            }
        }
        
        drawLine(ctx, currentPoint.current.x, currentPoint.current.y, newPoint.x, newPoint.y, strokeColor, strokeWidth, true, isEraser, isMarker);
        currentPoint.current = newPoint;
    };

    const handleLocalUndo = () => {
        if (myStrokeHistory.length === 0) return;
        const historyCopy = [...myStrokeHistory];
        const strokeToUndo = historyCopy.pop()!;
        setMyStrokeHistory(historyCopy);
        
        // Find all segments for this stroke
        const removedSegments: DrawData[] = [];
        const newFrames = framesRef.current.map(frame => {
            const keeping = [];
            for (const s of frame) {
                if (s.strokeId === strokeToUndo) removedSegments.push(s);
                else keeping.push(s);
            }
            return keeping;
        });
        
        framesRef.current = newFrames;
        setFrames(newFrames);
        redrawFrame(currentFrameRef.current);
        
        setUndoneStrokes(prev => [...prev, { id: strokeToUndo, segments: removedSegments }]);
        socket.emit('workspace_undo', { room: roomId, strokeId: strokeToUndo });
    };

    const handleLocalRedo = () => {
        if (undoneStrokes.length === 0) return;
        const undoneCopy = [...undoneStrokes];
        const strokeToRedo = undoneCopy.pop()!;
        setUndoneStrokes(undoneCopy);
        
        setMyStrokeHistory(prev => [...prev, strokeToRedo.id]);
        
        // Re-emit every segment
        strokeToRedo.segments.forEach(seg => {
            const newFrames = [...framesRef.current];
            while (newFrames.length <= seg.frameIndex) newFrames.push([]);
            newFrames[seg.frameIndex].push(seg);
            framesRef.current = newFrames;
            socket.emit('workspace_draw', { room: roomId, data: seg });
        });
        setFrames([...framesRef.current]);
        redrawFrame(currentFrameRef.current);
    };

    const clearCanvas = () => {
        socket.emit('workspace_clear', { room: roomId });
        framesRef.current = [[]];
        currentFrameRef.current = 0;
        setFrames([[]]);
        setCurrentFrameIndex(0);
        redrawFrame(0);
    };

    const downloadCanvas = () => {
        if (!canvasRef.current) return;
        const dataUrl = canvasRef.current.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `workspace-frame${currentFrameIndex}-${new Date().getTime()}.png`;
        link.href = dataUrl;
        link.click();
    };
    
    // Frame navigation
    const addFrame = () => {
        const newFrames = [...framesRef.current, []];
        const newIdx = newFrames.length - 1;
        framesRef.current = newFrames;
        setFrames(newFrames);
        changeFrame(newIdx);
    };
    
    const changeFrame = (idx: number) => {
        if (idx < 0 || idx >= framesRef.current.length) return;
        currentFrameRef.current = idx;
        setCurrentFrameIndex(idx);
        redrawFrame(idx);
        socket.emit('workspace_frame_change', { room: roomId, data: { frameIndex: idx } });
    };

    const colors = ['#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ffffff'];

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
            <div className="bg-[#18181b] w-full max-w-5xl h-[90vh] md:h-[85vh] rounded-2xl shadow-2xl border border-white/10 flex flex-col overflow-hidden">
                <div className="p-3 md:p-4 border-b border-white/5 flex flex-wrap items-center justify-between gap-3 bg-white/5">
                    <h3 className="font-semibold text-white flex items-center gap-2 text-sm md:text-base">
                        <PenTool size={18} className="text-emerald-400" />
                        <span className="hidden sm:inline">Collaborative Whiteboard</span>
                    </h3>
                    
                    {/* Toolbar */}
                    <div className="flex items-center gap-2 md:gap-4 flex-wrap">
                        <div className="flex items-center gap-1.5 md:gap-2 bg-black/40 p-1.5 rounded-xl border border-white/10">
                            {colors.map(c => (
                                <button
                                    key={c}
                                    onClick={() => { setColor(c); setIsEraser(false); setIsMarker(false); }}
                                    className={`w-5 h-5 md:w-6 md:h-6 rounded-full transition-all ${!isEraser && !isMarker && color === c ? 'scale-125 ring-2 ring-white/50' : 'opacity-70 hover:opacity-100 hover:scale-110'}`}
                                    style={{ backgroundColor: c }}
                                    title={`Color ${c}`}
                                />
                            ))}
                            <div className="w-px h-5 md:h-6 bg-white/10 mx-1"></div>
                            <button
                                onClick={() => { setIsMarker(true); setIsEraser(false); }}
                                className={`p-1.5 rounded-lg transition-colors ${isMarker ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white hover:bg-white/10'}`}
                                title="Highlighter"
                            >
                                <Highlighter size={16} />
                            </button>
                            <button
                                onClick={() => { setIsEraser(true); setIsMarker(false); }}
                                className={`p-1.5 rounded-lg transition-colors ${isEraser ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white hover:bg-white/10'}`}
                                title="Eraser"
                            >
                                <Eraser size={16} />
                            </button>
                            <div className="w-px h-5 md:h-6 bg-white/10 mx-1"></div>
                            <button
                                onClick={handleLocalUndo}
                                disabled={myStrokeHistory.length === 0}
                                className="p-1.5 rounded-lg transition-colors text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
                                title="Undo (Ctrl+Z)"
                            >
                                <Undo2 size={16} />
                            </button>
                            <button
                                onClick={handleLocalRedo}
                                disabled={undoneStrokes.length === 0}
                                className="p-1.5 rounded-lg transition-colors text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
                                title="Redo (Ctrl+Y)"
                            >
                                <Redo2 size={16} />
                            </button>
                        </div>
                        
                        {/* Brush Size */}
                        <div className="hidden sm:flex items-center gap-2">
                            <input 
                                type="range" 
                                min="1" max="20" 
                                value={thickness} 
                                onChange={(e) => setThickness(parseInt(e.target.value))}
                                className="w-20 md:w-24 accent-emerald-500"
                            />
                        </div>
                        
                        <div className="hidden md:block w-px h-6 bg-white/10"></div>
                        
                        {/* Animation Controls */}
                        <div className="flex items-center gap-1 bg-theme/10 border border-theme/20 p-1 rounded-xl">
                            <button 
                                onClick={() => changeFrame(currentFrameIndex - 1)}
                                disabled={currentFrameIndex === 0}
                                className="p-1.5 hover:bg-theme/20 text-theme-text disabled:opacity-30 disabled:hover:bg-transparent rounded-lg transition-colors"
                            >
                                <ChevronLeft size={16} />
                            </button>
                            <span className="text-xs font-mono text-theme-text/80 w-12 text-center font-bold">
                                {currentFrameIndex + 1}/{frames.length}
                            </span>
                            <button 
                                onClick={() => changeFrame(currentFrameIndex + 1)}
                                disabled={currentFrameIndex === frames.length - 1}
                                className="p-1.5 hover:bg-theme/20 text-theme-text disabled:opacity-30 disabled:hover:bg-transparent rounded-lg transition-colors"
                            >
                                <ChevronRight size={16} />
                            </button>
                            <button 
                                onClick={addFrame}
                                className="p-1.5 hover:bg-theme/20 text-theme-text rounded-lg transition-colors ml-1"
                                title="Add Frame"
                            >
                                <Plus size={16} />
                            </button>
                            <button 
                                onClick={() => setIsPlaying(!isPlaying)}
                                className={`p-1.5 rounded-lg transition-colors ml-1 ${isPlaying ? 'bg-rose-500/20 text-rose-400' : 'hover:bg-emerald-500/20 text-emerald-400'}`}
                                title={isPlaying ? "Stop Animation" : "Play Animation"}
                            >
                                {isPlaying ? <Square size={16} /> : <Play size={16} />}
                            </button>
                        </div>
                        
                        {/* Actions */}
                        <div className="flex items-center">
                            <button onClick={clearCanvas} className="p-2 hover:bg-rose-500/20 text-rose-400 rounded-lg transition-colors" title="Clear All Frames">
                                <Trash2 size={16} />
                            </button>
                            <button onClick={downloadCanvas} className="p-2 hover:bg-white/10 text-white/70 hover:text-white rounded-lg transition-colors" title="Download Frame">
                                <Download size={16} />
                            </button>
                            <button onClick={onClose} className="p-2 hover:bg-rose-500/20 text-white/50 hover:text-rose-400 rounded-lg transition-colors ml-1 border border-white/5" title="Close Workspace">
                                <X size={18} />
                            </button>
                        </div>
                    </div>
                </div>
                
                <div 
                    ref={containerRef} 
                    className="flex-1 w-full flex items-center justify-center bg-[#18181b] relative overflow-hidden touch-none"
                >
                    <div className="relative flex-shrink-0 bg-white/5 border border-white/10 shadow-2xl overflow-hidden" style={{
                        width: '100%',
                        height: '100%',
                        maxHeight: 'calc(100vw * 9 / 16)',
                        maxWidth: 'calc(100vh * 16 / 9)',
                        aspectRatio: '16/9'
                    }}>
                        <canvas
                            ref={canvasRef}
                            onMouseDown={onMouseDown}
                            onMouseUp={onMouseUp}
                            onMouseOut={onMouseUp}
                            onMouseMove={onMouseMove}
                            onTouchStart={onMouseDown}
                            onTouchEnd={onMouseUp}
                            onTouchCancel={onMouseUp}
                            onTouchMove={onMouseMove}
                            className="touch-none block w-full h-full cursor-crosshair"
                        />
                        
                        {/* Render Virtual Pointers */}
                        {Object.entries(pointers).map(([sid, ptr]) => (
                            <div 
                                key={sid}
                                className="absolute pointer-events-none transition-all duration-75"
                                style={{
                                    left: `${ptr.x * 100}%`,
                                    top: `${ptr.y * 100}%`,
                                    transform: 'translate(-2px, -2px)'
                                }}
                            >
                                <MousePointer2 size={24} className="text-white drop-shadow-md" style={{ fill: stringToColor(sid) }} />
                                <div className="mt-1 ml-4 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-lg whitespace-nowrap" style={{ backgroundColor: stringToColor(sid) }}>
                                    {ptr.name}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
