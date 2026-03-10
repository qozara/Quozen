import { ExpenseSplit } from "./models";

export interface MemberInput {
    email?: string;
    username?: string;
}

export interface MemberInput {
    email?: string;
    username?: string;
}

export interface CreateGroupDTO {
    name: string;
    members?: { email?: string; username?: string }[];
}

export interface UpdateGroupDTO {
    name?: string;
    members?: { email?: string; username?: string }[];
}

export interface CreateExpenseDTO {
    description: string;
    amount: number;
    category: string;
    date: Date;
    paidByUserId: string;
    splits?: ExpenseSplit[];
}

export interface CreateSettlementDTO {
    date?: Date;
    fromUserId: string;
    toUserId: string;
    amount: number;
    method?: string;
    notes?: string;
}

export interface UpdateExpenseDTO extends Partial<CreateExpenseDTO> { }
export interface UpdateSettlementDTO extends Partial<CreateSettlementDTO> { }
