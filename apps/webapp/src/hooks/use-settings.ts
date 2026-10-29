import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { quozen } from "@/lib/storage";
import { UserSettings, docToUserSettings } from "@quozen/core";
import { useAuth } from "@/context/auth-provider";
import { useEffect } from "react";
import i18n from "@/lib/i18n";

export function useSettings() {
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["drive", "settings", user?.email];

  const query = useQuery({
    queryKey: queryKey,
    queryFn: () => {
      return quozen.groups.getSettings();
    },
    enabled: !!user?.email && isAuthenticated,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Reactive RxDB subscription to global_settings document
  useEffect(() => {
    if (!isAuthenticated || !user?.email) return;

    let sub: { unsubscribe: () => void } | undefined;
    let isCancelled = false;

    const setupSubscription = () => {
      const db = (quozen.db as any);
      if (!db?.user_settings) return false;

      const observable = db.user_settings.findOne("global_settings").$;
      if (!observable?.subscribe) return false;

      sub = observable.subscribe({
        next: (doc: any) => {
          if (!doc || isCancelled) return;
          const raw = doc.toJSON ? doc.toJSON() : doc;
          if (raw.deletedAt) return;
          const newSettings = docToUserSettings(raw);
          queryClient.setQueryData(queryKey, newSettings);
          void queryClient.invalidateQueries({ queryKey: ["drive", "groups", user?.email] });
        },
        error: (err: any) => {
          console.warn("[useSettings] RxDB subscription error:", err);
        }
      });
      return true;
    };

    if (!setupSubscription()) {
      const interval = setInterval(() => {
        if (setupSubscription()) {
          clearInterval(interval);
        }
      }, 300);
      return () => {
        isCancelled = true;
        clearInterval(interval);
        sub?.unsubscribe();
      };
    }

    return () => {
      isCancelled = true;
      sub?.unsubscribe();
    };
  }, [isAuthenticated, user?.email, queryClient]);

  // Sync i18n with settings
  useEffect(() => {
    if (query.data?.preferences?.locale) {
      const pref = query.data.preferences.locale;
      if (pref === 'system') {
        // Detect browser language (simple check)
        const detected = navigator.language.split('-')[0];
        const target = ['es', 'en'].includes(detected) ? detected : 'en';
        if (i18n.language !== target) {
          i18n.changeLanguage(target);
        }
      } else {
        if (i18n.language !== pref) {
          i18n.changeLanguage(pref);
        }
      }
    }
  }, [query.data?.preferences?.locale]);

  const mutation = useMutation({
    mutationFn: (newSettings: UserSettings) => {
      return quozen.groups.saveSettings(newSettings);
    },
    onSuccess: (_, variables) => {
      queryClient.setQueryData(queryKey, variables);
      queryClient.invalidateQueries({ queryKey: ["drive", "groups", user?.email] });
    },
  });

  const activeGroupMutation = useMutation({
    mutationFn: (groupId: string) => {
      return quozen.groups.updateActiveGroup(groupId);
    },
    onSuccess: (_, groupId) => {
      // Optimistic update of local cache for smoother UI
      queryClient.setQueryData(queryKey, (old: UserSettings | undefined) => {
        if (!old) return old;
        return { ...old, activeGroupId: groupId };
      });
      queryClient.invalidateQueries({ queryKey: queryKey });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: queryKey });
    }
  });

  const groupAccountMutation = useMutation({
    mutationFn: ({ groupId, accountId }: { groupId: string; accountId: string }) => {
      return quozen.groups.updateGroupAccount(groupId, accountId);
    },
    onSuccess: (_, { groupId, accountId }) => {
      queryClient.setQueryData(queryKey, (old: UserSettings | undefined) => {
        if (!old) return old;
        return {
          ...old,
          groupCache: (old.groupCache || []).map(g =>
            g.id === groupId ? { ...g, accountId, lastAccessed: new Date().toISOString() } : g
          )
        };
      });
      queryClient.invalidateQueries({ queryKey: queryKey });
    }
  });

  const archiveGroupMutation = useMutation({
    mutationFn: (groupId: string) => {
      return quozen.groups.archiveGroup(groupId);
    },
    onMutate: async (groupId: string) => {
      await queryClient.cancelQueries({ queryKey });
      const previousSettings = queryClient.getQueryData<UserSettings>(queryKey);

      queryClient.setQueryData<UserSettings | undefined>(queryKey, (old) => {
        if (!old) return old;
        const nowIso = new Date().toISOString();
        const target = old.groupCache.find(g => g.id === groupId);
        const remaining = old.groupCache.filter(g => g.id !== groupId);
        const archived = [
          ...(old.archivedGroupCache || []).filter(g => g.id !== groupId),
          ...(target ? [{ ...target, isArchived: true, lastAccessed: nowIso, updatedAt: nowIso }] : [])
        ];
        return {
          ...old,
          groupCache: remaining,
          archivedGroupCache: archived,
          activeGroupId: old.activeGroupId === groupId ? (remaining[0]?.id || null) : old.activeGroupId
        };
      });

      return { previousSettings };
    },
    onError: (err: any, _groupId, context) => {
      if (err?.name === "GroupFileUnavailableError") {
        return;
      }
      if (context?.previousSettings) {
        queryClient.setQueryData(queryKey, context.previousSettings);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    }
  });

  const unarchiveGroupMutation = useMutation({
    mutationFn: (groupId: string) => {
      return quozen.groups.unarchiveGroup(groupId);
    },
    onMutate: async (groupId: string) => {
      await queryClient.cancelQueries({ queryKey });
      const previousSettings = queryClient.getQueryData<UserSettings>(queryKey);

      queryClient.setQueryData<UserSettings | undefined>(queryKey, (old) => {
        if (!old) return old;
        const nowIso = new Date().toISOString();
        const target = old.archivedGroupCache?.find(g => g.id === groupId);
        const remainingArchived = (old.archivedGroupCache || []).filter(g => g.id !== groupId);
        const restored = [
          ...(target ? [{ ...target, isArchived: false, lastAccessed: nowIso, updatedAt: nowIso }] : []),
          ...old.groupCache.filter(g => g.id !== groupId)
        ];
        return {
          ...old,
          groupCache: restored,
          archivedGroupCache: remainingArchived,
          activeGroupId: groupId
        };
      });

      return { previousSettings };
    },
    onError: (err: any, _groupId, context) => {
      if (err?.name === "GroupFileUnavailableError") {
        return;
      }
      if (context?.previousSettings) {
        queryClient.setQueryData(queryKey, context.previousSettings);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    }
  });

  return {
    settings: query.data,
    isLoading: query.isLoading,
    error: query.error,
    updateSettings: mutation.mutate,
    updateSettingsAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
    updateActiveGroup: activeGroupMutation.mutate,
    updateGroupAccount: groupAccountMutation.mutate,
    updateGroupAccountAsync: groupAccountMutation.mutateAsync,
    archiveGroup: archiveGroupMutation.mutate,
    archiveGroupAsync: archiveGroupMutation.mutateAsync,
    unarchiveGroup: unarchiveGroupMutation.mutate,
    unarchiveGroupAsync: unarchiveGroupMutation.mutateAsync,
  };
}
