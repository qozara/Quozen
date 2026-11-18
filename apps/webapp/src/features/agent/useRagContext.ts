import { useAppContext } from "@/context/app-context";
import { useQuery } from "@tanstack/react-query";
import { quozen } from "@/lib/storage";

export const useRagContext = () => {
    const { activeGroupId, currentUserId } = useAppContext();

    const { data: ledger } = useQuery({
        queryKey: ["drive", "group", activeGroupId],
        queryFn: () => quozen.ledger(activeGroupId!, currentUserId).getLedger(),
        enabled: !!activeGroupId,
    });

    return {
        ledger,
        activeGroupId,
        currentUserId,
        isLoading: !ledger
    };
};
