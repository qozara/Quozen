import { useQuery } from "@tanstack/react-query";
import { quozen } from "@/lib/storage";
import { GroupParticipantsOverview } from "@quozen/core";

export function useGroupParticipants(groupId?: string, enabled = true) {
    let result: any;
    try {
        result = useQuery<GroupParticipantsOverview>({
            queryKey: ["group-participants", groupId],
            queryFn: () => {
                if (!groupId) throw new Error("groupId is required");
                return quozen.groups.getGroupParticipants(groupId);
            },
            enabled: Boolean(groupId) && enabled,
            staleTime: 10000
        });
    } catch {
        result = { data: undefined, isLoading: false, isError: false };
    }
    return result;
}
