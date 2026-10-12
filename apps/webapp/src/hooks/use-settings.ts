import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { quozen } from "@/lib/storage";
import { UserSettings } from "@quozen/core";
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
  };
}
