/* eslint-disable react/prop-types */
import { useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FileText, Edit2, Trash2, FolderPlus, FilePlus } from 'lucide-react';
import clsx from 'clsx';

/**
 * Reusable TreeView component (VS Code explorer style)
 *
 * Props:
 *  - folders: array of { id, name, parent_id, squad_id }
 *  - flows: array of { id, name, folder_id }
 *  - selectedFlowId: currently selected flow id
 *  - onSelectFlow: (flow) => void
 *  - onRenameFolder: (e, folder) => void
 *  - onDeleteFolder: (folderId) => void
 *  - onAddSubfolder: (parentId) => void
 *  - onAddFlow: (folderId) => void
 *  - onRenameFlow: (e, flow) => void
 *  - onDeleteFlow: (e, flow) => void
 *  - onDragStartFlow: (e, flowId) => void
 *  - onDropToFolder: (e, folderId) => void
 *  - breadcrumbPath: array of { id, name } — computed externally
 */
export default function TreeView({
    folders = [],
    flows = [],
    selectedFlowId,
    onSelectFlow,
    onRenameFolder,
    onDeleteFolder,
    onAddSubfolder,
    onAddFlow,
    onRenameFlow,
    onDeleteFlow,
    onDragStartFlow,
    onDropToFolder,
    maxFolderDepth = 3,
}) {
    const [expandedFolders, setExpandedFolders] = useState([]);
    const [dragOverFolderId, setDragOverFolderId] = useState(null);

    const toggleFolder = (id) => {
        setExpandedFolders(prev =>
            prev.includes(id) ? prev.filter(fId => fId !== id) : [...prev, id]
        );
    };

    const renderTree = (parentId, level) => {
        const childFolders = folders.filter(f => f.parent_id === parentId);
        const childFlows = flows.filter(f => (f.folder_id || null) === parentId);

        return (
            <div className="w-full pr-4">
                {childFolders.map(folder => (
                    <div key={`folder-${folder.id}`}>
                        <div // NOSONAR
                            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverFolderId(folder.id); }} // NOSONAR
                            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverFolderId(null); }} // NOSONAR
                            onDrop={(e) => { setDragOverFolderId(null); onDropToFolder?.(e, folder.id); }} // NOSONAR
                            className={clsx(
                                "flex items-center justify-between py-1.5 pr-2 rounded group transition-colors",
                                dragOverFolderId === folder.id ? "bg-blue-100 ring-1 ring-blue-300" : "hover:bg-slate-100"
                            )}
                            style={{ paddingLeft: `${level * 16 + 8}px` }}
                        >
                            <button
                                type="button"
                                onClick={() => toggleFolder(folder.id)}
                                className="flex items-center gap-1 min-w-0 pr-4 flex-1 text-left bg-transparent border-none outline-none cursor-pointer"
                            >
                                <span className="text-slate-400 shrink-0">
                                    {expandedFolders.includes(folder.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                </span>
                                <Folder size={16} className="text-blue-500 shrink-0" />
                                <span className="text-sm font-medium text-slate-700 select-none ml-1 truncate" title={folder.name}>{folder.name}</span>
                            </button>
                            <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 shrink-0 z-10 items-center">
                                {onRenameFolder && <button onClick={(e) => { e.stopPropagation(); onRenameFolder(e, folder); }} className="text-slate-400 hover:text-amber-500" title="Rename"><Edit2 size={14} /></button>}
                                {onAddSubfolder && level < maxFolderDepth - 1 && <button onClick={(e) => { e.stopPropagation(); onAddSubfolder(folder.id); }} className="text-slate-400 hover:text-blue-600" title="Add Subfolder"><FolderPlus size={14} /></button>}
                                {onAddFlow && <button onClick={(e) => { e.stopPropagation(); onAddFlow(folder.id); }} className="text-slate-400 hover:text-green-600" title="Add Flow"><FilePlus size={14} /></button>}
                                {onDeleteFolder && <button onClick={(e) => { e.stopPropagation(); onDeleteFolder(folder.id); }} className="text-slate-400 hover:text-red-500" title="Delete"><Trash2 size={14} /></button>}
                            </div>
                        </div>
                        {expandedFolders.includes(folder.id) && (
                            <div className="mt-0.5 border-l border-slate-200 ml-4">
                                {renderTree(folder.id, level + 1)}
                            </div>
                        )}
                    </div>
                ))}

                {childFlows.map(flow => (
                    <div // NOSONAR
                        key={`flow-${flow.id}`}
                        draggable="true"
                        onDragStart={(e) => onDragStartFlow?.(e, flow.id)}
                        className={clsx(
                            "flex items-center justify-between py-1.5 pr-2 rounded group transition-colors",
                            selectedFlowId === flow.id ? "bg-blue-50 border-l-2 border-blue-500" : "hover:bg-slate-50 border-l-2 border-transparent"
                        )}
                        style={{ paddingLeft: `${level * 16 + 24}px` }}
                    >
                        <button
                            type="button"
                            onClick={() => onSelectFlow?.(flow)}
                            className="flex items-center gap-1.5 min-w-0 pr-4 flex-1 text-left bg-transparent border-none outline-none cursor-pointer"
                        >
                            <FileText size={14} className="text-green-500 shrink-0" />
                            <span className="text-sm text-slate-600 select-none truncate" title={flow.name}>
                                {flow.name}
                            </span>
                        </button>
                        <span className="text-xs text-blue-600 ml-1 font-bold shrink-0">(ID: {flow.id})</span>
                        <div className={clsx(
                            "flex gap-1.5 opacity-0 group-hover:opacity-100 shrink-0 z-10 items-center",
                            selectedFlowId === flow.id ? "bg-blue-50" : "bg-slate-50"
                        )}>
                            {onRenameFlow && <button onClick={(e) => { e.stopPropagation(); onRenameFlow(e, flow); }} className="text-slate-400 hover:text-amber-500" title="Rename"><Edit2 size={14} /></button>}
                            {onDeleteFlow && <button onClick={(e) => { e.stopPropagation(); onDeleteFlow(e, flow); }} className="text-slate-400 hover:text-red-500" title="Delete"><Trash2 size={14} /></button>}
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <section
            aria-label="Tree view dropzone"
            className="w-max min-w-full min-h-full"
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverFolderId('root'); }} // NOSONAR
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverFolderId(null); }} // NOSONAR
            onDrop={(e) => { setDragOverFolderId(null); onDropToFolder?.(e, null); }} // NOSONAR
            style={{ backgroundColor: dragOverFolderId === 'root' ? '#f8fafc' : 'transparent' }}
        >
            {renderTree(null, 0)}
            {folders.length === 0 && flows.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-4 pointer-events-none">Click + to create folder or flow</p>
            )}
        </section>
    );
}
