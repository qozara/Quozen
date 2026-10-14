import { useAppContext } from "@/context/app-context";
import { useQuery } from "@tanstack/react-query";
import { quozen } from "@/lib/storage";
import { useAuth } from "@/context/auth-provider";
import { AgentOrchestrator } from "@quozen/core";

export const useRagContext = () => {
    const { activeGroupId, currentUserId } = useAppContext();
    const { user: authUser } = useAuth();

    const { data: ledger } = useQuery({
        queryKey: ["drive", "group", activeGroupId],
        queryFn: () => quozen.ledger(activeGroupId!, currentUserId).getLedger(),
        enabled: !!activeGroupId,
    });

    const activeMember = ledger?.members?.find(m => m.userId === currentUserId);
    const me = authUser
        ? {
            ...authUser,
            id: activeMember?.userId || currentUserId || authUser.id,
            name: activeMember?.name || authUser.name,
            username: activeMember?.name || authUser.username,
        }
        : null;

    const systemPrompt = (ledger && me && activeGroupId)
        ? AgentOrchestrator.buildSystemPrompt({ ledger, me, activeGroupId })
        : "";

    return {
        systemPrompt,
        ledger,
        activeGroupId,
        currentUserId,
        isLoading: !ledger
    };
};
