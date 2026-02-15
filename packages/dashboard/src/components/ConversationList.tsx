import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  fetchConversations,
  deleteConversation,
  renameConversation,
  type Conversation,
} from '../api/client';

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (id: string | null) => void;
  onNew: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function ConversationList({
  activeConversationId,
  onSelect,
  onNew,
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onMobileClose,
}: ConversationListProps) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const { data } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => fetchConversations({ limit: 100 }),
    refetchInterval: 30000,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteConversation,
    onSuccess: (_result, deletedId) => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (activeConversationId === deletedId) {
        onSelect(null);
      }
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renameConversation(id, title),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      setEditingId(null);
    },
  });

  const handleStartRename = useCallback((conv: Conversation) => {
    setEditingId(conv.id);
    setEditTitle(conv.title);
  }, []);

  const handleSubmitRename = useCallback(() => {
    if (editingId && editTitle.trim()) {
      renameMutation.mutate({ id: editingId, title: editTitle.trim() });
    }
  }, [editingId, editTitle, renameMutation]);

  const handleCancelRename = useCallback(() => {
    setEditingId(null);
    setEditTitle('');
  }, []);

  // Close mobile panel on selection
  const handleSelect = useCallback(
    (id: string | null) => {
      onSelect(id);
      onMobileClose();
    },
    [onSelect, onMobileClose]
  );

  const handleNew = useCallback(() => {
    onNew();
    onMobileClose();
  }, [onNew, onMobileClose]);

  // Close on escape
  useEffect(() => {
    if (!mobileOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMobileClose();
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, [mobileOpen, onMobileClose]);

  const conversations = data?.conversations ?? [];

  const listContent = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b">
        <span className="text-sm font-medium">Conversations</span>
        <div className="flex items-center gap-1">
          <button onClick={handleNew} className="btn-ghost p-1.5 rounded" title="New conversation">
            <Plus className="w-4 h-4" />
          </button>
          {/* Hide collapse on mobile — use backdrop dismiss instead */}
          <button
            onClick={onToggleCollapse}
            className="btn-ghost p-1.5 rounded hidden md:flex"
            title="Collapse"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={onMobileClose}
            className="btn-ghost p-1.5 rounded md:hidden"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No conversations yet
          </div>
        )}
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
              activeConversationId === conv.id
                ? 'bg-primary/15 border-l-2 border-primary'
                : 'hover:bg-muted/50'
            }`}
            onClick={() => {
              if (editingId !== conv.id) handleSelect(conv.id);
            }}
          >
            <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />

            {editingId === conv.id ? (
              <div className="flex items-center gap-1 flex-1 min-w-0">
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => {
                    setEditTitle(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSubmitRename();
                    if (e.key === 'Escape') handleCancelRename();
                  }}
                  className="flex-1 min-w-0 text-xs bg-background border rounded px-1.5 py-1"
                  autoFocus
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSubmitRename();
                  }}
                  className="p-1"
                >
                  <Check className="w-3.5 h-3.5 text-success" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCancelRename();
                  }}
                  className="p-1"
                >
                  <X className="w-3.5 h-3.5 text-destructive" />
                </button>
              </div>
            ) : (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{conv.title}</p>
                  <p className="text-[10px] text-muted-foreground">{conv.messageCount} msgs</p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 md:transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStartRename(conv);
                    }}
                    className="p-1 hover:text-primary"
                    title="Rename"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteMutation.mutate(conv.id);
                    }}
                    className="p-1 hover:text-destructive"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );

  // ── Mobile: slide-over drawer ────────────────────────────────
  // Rendered as a fixed overlay on small screens
  const mobileDrawer = (
    <>
      {/* Backdrop */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={onMobileClose} />
      )}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-card border-r flex flex-col transform transition-transform duration-200 md:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {listContent}
      </div>
    </>
  );

  // ── Desktop collapsed: icon rail ─────────────────────────────
  if (collapsed) {
    return (
      <>
        {mobileDrawer}
        <div className="hidden md:flex flex-col items-center py-2 border-r w-10 flex-shrink-0">
          <button
            onClick={onToggleCollapse}
            className="btn-ghost p-1.5 rounded mb-2"
            title="Expand conversations"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button onClick={onNew} className="btn-ghost p-1.5 rounded mb-2" title="New conversation">
            <Plus className="w-4 h-4" />
          </button>
          {conversations.slice(0, 10).map((conv) => (
            <button
              key={conv.id}
              onClick={() => {
                onSelect(conv.id);
              }}
              className={`p-1.5 rounded mb-0.5 transition-colors ${
                activeConversationId === conv.id ? 'bg-primary/15 text-primary' : 'btn-ghost'
              }`}
              title={conv.title}
            >
              <MessageSquare className="w-3.5 h-3.5" />
            </button>
          ))}
        </div>
      </>
    );
  }

  // ── Desktop expanded: sidebar panel ──────────────────────────
  return (
    <>
      {mobileDrawer}
      <div className="hidden md:flex flex-col border-r w-64 flex-shrink-0 overflow-hidden">
        {listContent}
      </div>
    </>
  );
}
