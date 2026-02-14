import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Store, Download, Trash2, Loader2, Search } from 'lucide-react';

interface MarketplaceSkill {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  category: string;
  downloads: number;
  installed: boolean;
  createdAt: number;
}

const API_HEADERS = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('friday_token')}`,
});

async function searchMarketplace(query?: string): Promise<{ skills: MarketplaceSkill[]; total: number }> {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  const res = await fetch(`/api/v1/marketplace?${params}`, { headers: API_HEADERS() });
  if (!res.ok) throw new Error('Failed to search marketplace');
  return res.json();
}

async function installSkill(id: string): Promise<void> {
  const res = await fetch(`/api/v1/marketplace/${id}/install`, { method: 'POST', headers: API_HEADERS() });
  if (!res.ok) throw new Error('Failed to install skill');
}

async function uninstallSkill(id: string): Promise<void> {
  const res = await fetch(`/api/v1/marketplace/${id}/uninstall`, { method: 'POST', headers: API_HEADERS() });
  if (!res.ok) throw new Error('Failed to uninstall skill');
}

export function MarketplacePage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['marketplace', query], queryFn: () => searchMarketplace(query || undefined) });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['marketplace'] });
    void queryClient.invalidateQueries({ queryKey: ['skills'] });
  };
  const installMut = useMutation({ mutationFn: installSkill, onSuccess: invalidate });
  const uninstallMut = useMutation({ mutationFn: uninstallSkill, onSuccess: invalidate });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Skill Marketplace</h1>
        <p className="text-muted-foreground text-sm mt-1">Browse and install skills</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          className="w-full bg-card border border-border rounded-lg pl-10 pr-3 py-2.5 text-sm"
          placeholder="Search skills..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : !data?.skills.length ? (
        <div className="card p-12 text-center">
          <Store className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">{query ? 'No skills found' : 'Marketplace is empty'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.skills.map((skill) => (
            <div key={skill.id} className="card p-4 flex flex-col">
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">{skill.name}</h3>
                  <span className="text-xs text-muted-foreground">v{skill.version}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{skill.description}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                  <span>{skill.author}</span>
                  <span>{skill.category}</span>
                  <span>{skill.downloads} installs</span>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-border">
                {skill.installed ? (
                  <button
                    className="btn btn-ghost text-destructive flex items-center gap-2 w-full justify-center"
                    onClick={() => uninstallMut.mutate(skill.id)}
                    disabled={uninstallMut.isPending}
                  >
                    <Trash2 className="w-4 h-4" /> Uninstall
                  </button>
                ) : (
                  <button
                    className="btn btn-primary flex items-center gap-2 w-full justify-center"
                    onClick={() => installMut.mutate(skill.id)}
                    disabled={installMut.isPending}
                  >
                    {installMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    Install
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
