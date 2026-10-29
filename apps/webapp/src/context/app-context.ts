import { createContext, useContext } from "react";
import type { ExpenseDraft, SettlementDraft } from "@quozen/core";
import type { Settlement } from "@quozen/core";

export interface SettlementDraftState {
  isOpen: boolean;
  draft?: SettlementDraft;
  fromUser?: { userId: string; name: string };
  toUser?: { userId: string; name: string };
  suggestedAmount?: number;
  initialData?: Settlement;
  meta?: {
    rawInput?: string;
    isAiEscalated?: boolean;
    ambiguities?: string[];
  };
}

export interface AppState {
  activeGroupId: string;
  setActiveGroupId: (groupId: string) => void;
  currentUserId: string;
  setActiveAccountId?: (accountId: string) => void;
  isAddExpenseOpen: boolean;
  setIsAddExpenseOpen: (isOpen: boolean) => void;
  expenseDraft: ExpenseDraft | null;
  setExpenseDraft: (draft: ExpenseDraft | null) => void;
  expenseDraftMeta?: {
    rawInput?: string;
    isAiEscalated?: boolean;
    ambiguities?: string[];
  } | null;
  openExpenseWithDraft: (
    draft: ExpenseDraft,
    meta?: { rawInput?: string; isAiEscalated?: boolean; ambiguities?: string[] }
  ) => void;
  settlementDraftState: SettlementDraftState;
  setSettlementDraftState: React.Dispatch<React.SetStateAction<SettlementDraftState>>;
  openSettlementWithDraft: (
    draft: SettlementDraft,
    meta?: { rawInput?: string; isAiEscalated?: boolean; ambiguities?: string[] }
  ) => void;
  schemaErrorStatus: 'CORRUPTED' | 'UPGRADE_REQUIRED' | 'INCOMPATIBLE' | null;
  setSchemaErrorStatus: (status: 'CORRUPTED' | 'UPGRADE_REQUIRED' | 'INCOMPATIBLE' | null) => void;
}

export const AppContext = createContext<AppState | undefined>(undefined);

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within AppProvider");
  }
  return context;
};
