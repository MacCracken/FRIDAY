/**
 * Shared hooks for catalog install/uninstall, personality initialization, and community sync.
 * Extracted from CommunityTab + MarketplaceTab to eliminate duplication.
 */

import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  installMarketplaceSkill,
  uninstallMarketplaceSkill,
  syncCommunitySkills,
} from '../../api/client';
import type { Personality } from '../../types';

interface SyncResult {
  added: number;
  updated: number;
  skipped: number;
  removed: number;
  errors: string[];
  workflowsAdded?: number;
  workflowsUpdated?: number;
  swarmsAdded?: number;
  swarmsUpdated?: number;
  themesAdded?: number;
  themesUpdated?: number;
  personalitiesAdded?: number;
  personalitiesUpdated?: number;
}

export type { SyncResult };

/**
 * Wraps install + uninstall mutations with loading state tracking per item.
 * `invalidateKeys` controls which query keys are invalidated on success.
 */
export function useCatalogInstall(invalidateKeys: string[][]) {
  const queryClient = useQueryClient();
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);

  const invalidate = () => {
    for (const key of invalidateKeys) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const installMut = useMutation({
    mutationFn: ({ id, personalityId }: { id: string; personalityId?: string }) =>
      installMarketplaceSkill(id, personalityId),
    onSuccess: () => {
      invalidate();
      setInstallingId(null);
    },
    onError: () => {
      setInstallingId(null);
    },
  });

  const uninstallMut = useMutation({
    mutationFn: ({ id, personalityId }: { id: string; personalityId?: string }) =>
      uninstallMarketplaceSkill(id, personalityId),
    onSuccess: () => {
      invalidate();
      setUninstallingId(null);
    },
    onError: () => {
      setUninstallingId(null);
    },
  });

  return {
    installingId,
    setInstallingId,
    uninstallingId,
    setUninstallingId,
    installMut,
    uninstallMut,
    isInstalling: (id: string) => installingId === id && installMut.isPending,
    isUninstalling: (id: string) => uninstallingId === id && uninstallMut.isPending,
    invalidate,
  };
}

/**
 * Pre-selects the active personality on first load.
 * Returns [selectedId, setSelectedId].
 */
export function usePersonalityInit(
  personalities: Personality[]
): [string, React.Dispatch<React.SetStateAction<string>>] {
  const [selectedPersonalityId, setSelectedPersonalityId] = useState('');
  const initialized = useRef(false);
  const activePersonality = personalities.find((p) => p.isActive);

  useEffect(() => {
    if (activePersonality && !initialized.current) {
      initialized.current = true;
      setSelectedPersonalityId(activePersonality.id);
    }
  }, [activePersonality]);

  return [selectedPersonalityId, setSelectedPersonalityId];
}

/**
 * Wraps community sync mutation + result state + dismiss logic.
 */
export function useCommunitySync(onSuccess?: () => void) {
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  const syncMut = useMutation({
    mutationFn: syncCommunitySkills,
    onSuccess: (result) => {
      setSyncResult(result);
      onSuccess?.();
    },
  });

  const triggerSync = () => {
    setSyncResult(null);
    syncMut.mutate();
  };

  return {
    syncResult,
    setSyncResult,
    syncMut,
    triggerSync,
    dismissSync: () => {
      setSyncResult(null);
    },
  };
}
