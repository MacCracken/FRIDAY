import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Store, Download, Trash2, Loader2, Search } from 'lucide-react';
import {
  fetchMarketplaceSkills,
  installMarketplaceSkill,
  uninstallMarketplaceSkill,
} from '../api/client';

interface MarketplaceSkill {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  category: string;
  downloadCount: number;
  installed: boolean;
}

export function MarketplacePage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['marketplace', query],
    queryFn: () => fetchMarketplaceSkills(query || undefined),
  });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['marketplace'] });
    void queryClient.invalidateQueries({ queryKey: ['skills'] });
  };
  const installMut = useMutation({
    mutationFn: (id: string) => installMarketplaceSkill(id),
    onSuccess: invalidate,
  });
  const uninstallMut = useMutation({
    mutationFn: uninstallMarketplaceSkill,
    onSuccess: invalidate,
  });

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
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : !data?.skills.length ? (
        <div className="card p-12 text-center">
          <Store className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">
            {query ? 'No skills found' : 'Marketplace is empty'}
          </p>
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
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {skill.description}
                </p>
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                  <span>{skill.author}</span>
                  <span>{skill.category}</span>
                  <span>{skill.downloadCount} installs</span>
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
                    {installMut.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
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
