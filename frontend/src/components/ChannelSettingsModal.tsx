import { useState } from 'react';
import { X, Settings, Hash, Volume2 } from 'lucide-react';
import type { Channel } from '../App';

interface ChannelSettingsModalProps {
    onClose: () => void;
    channel: Channel | null; // If null, we are creating a new channel
    onSave: (id: string, name: string, description: string, type: 'text' | 'voice') => void;
    onDelete?: (id: string) => void;
}

export function ChannelSettingsModal({ onClose, channel, onSave, onDelete }: ChannelSettingsModalProps) {
    const isEditing = !!channel;
    const [name, setName] = useState(channel?.name || '');
    const [description, setDescription] = useState(channel?.description || '');
    const [type, setType] = useState<'text' | 'voice'>(channel?.type || 'text');

    const handleSave = () => {
        if (!name.trim()) return;
        const id = isEditing ? channel.id : name.toLowerCase().replace(/\s+/g, '-');
        onSave(id, name.trim(), description.trim(), type);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-[#18181b] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between p-4 border-b border-white/5 bg-white/5">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        <Settings size={20} className="text-white/50" />
                        {isEditing ? 'Channel Settings' : 'Create Channel'}
                    </h2>
                    <button onClick={onClose} className="p-1 rounded-lg text-white/50 hover:bg-white/10 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-4 md:p-6 overflow-y-auto space-y-6">
                    <div className="space-y-3">
                        <label className="text-xs font-bold text-white/50 uppercase tracking-widest">Channel Type</label>
                        <div className="flex gap-3">
                            <button 
                                onClick={() => setType('text')}
                                className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${type === 'text' ? 'border-indigo-500 bg-indigo-500/10 text-white' : 'border-white/5 bg-white/5 text-white/50 hover:bg-white/10'}`}
                            >
                                <Hash size={24} className={type === 'text' ? 'text-indigo-400' : ''} />
                                <span className="font-semibold text-sm">Text</span>
                            </button>
                            <button 
                                onClick={() => setType('voice')}
                                className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${type === 'voice' ? 'border-emerald-500 bg-emerald-500/10 text-white' : 'border-white/5 bg-white/5 text-white/50 hover:bg-white/10'}`}
                            >
                                <Volume2 size={24} className={type === 'voice' ? 'text-emerald-400' : ''} />
                                <span className="font-semibold text-sm">Voice</span>
                            </button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-bold text-white/50 uppercase tracking-widest">Channel Name</label>
                        <input 
                            type="text" 
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="e.g. general"
                            className="w-full bg-black/50 border border-white/10 rounded-xl p-3 text-white placeholder-white/30 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-bold text-white/50 uppercase tracking-widest">Description</label>
                        <input 
                            type="text" 
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Optional topic or description"
                            className="w-full bg-black/50 border border-white/10 rounded-xl p-3 text-white placeholder-white/30 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                        />
                    </div>
                </div>

                <div className="p-4 border-t border-white/5 bg-black/20 flex items-center justify-between">
                    {isEditing && channel.id !== 'general' ? (
                        <button 
                            onClick={() => {
                                if (confirm(`Are you sure you want to delete #${channel.name}?`)) {
                                    onDelete?.(channel.id);
                                }
                            }}
                            className="px-4 py-2 text-sm font-semibold text-rose-400 hover:bg-rose-500/10 rounded-xl transition-colors"
                        >
                            Delete Channel
                        </button>
                    ) : (
                        <div></div>
                    )}
                    <div className="flex items-center gap-2">
                        <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-white/70 hover:bg-white/10 rounded-xl transition-colors">
                            Cancel
                        </button>
                        <button 
                            onClick={handleSave}
                            disabled={!name.trim()}
                            className="px-6 py-2 text-sm font-semibold bg-indigo-500 text-white rounded-xl hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[0_0_15px_rgba(99,102,241,0.4)]"
                        >
                            {isEditing ? 'Save Changes' : 'Create'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
