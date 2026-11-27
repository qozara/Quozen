import { GroupClosedError, GroupNotSettledError } from "../errors";

export type GroupStatus = "open" | "closed";

export const BALANCE_ZERO_EPSILON = 0.01;

export function normalizeGroupStatus(raw?: string | null): GroupStatus {
    return raw === "closed" ? "closed" : "open";
}

export function getNonZeroBalances(balances: Record<string, number>): Record<string, number> {
    const nonZero: Record<string, number> = {};
    for (const [userId, balance] of Object.entries(balances)) {
        if (Math.abs(balance) >= BALANCE_ZERO_EPSILON) {
            nonZero[userId] = balance;
        }
    }
    return nonZero;
}

export function areAllBalancesZero(balances: Record<string, number>): boolean {
    return Object.values(balances).every((b) => Math.abs(b) < BALANCE_ZERO_EPSILON);
}

export interface IGroupLifecycleState {
    readonly status: GroupStatus;
    readonly isClosed: boolean;
    readonly isReadOnly: boolean;
    readonly canEditTransactions: boolean;
    readonly canEditGroupMetadata: boolean;
    readonly canManageRoster: boolean;
    readonly canCreateCommandDraft: boolean;
    readonly canClose: boolean;
    readonly canReopen: boolean;
    assertCanMutateTransactions(): void;
    assertCanMutateGroupMetadata(): void;
    assertCanMutateRoster(): void;
    assertCanCreateDraft(): void;
    assertCanTransitionToClosed(balances: Record<string, number>, force?: boolean): void;
}

export class OpenGroupState implements IGroupLifecycleState {
    public readonly status: GroupStatus = "open";
    public readonly isClosed = false;
    public readonly isReadOnly = false;
    public readonly canEditTransactions = true;
    public readonly canEditGroupMetadata = true;
    public readonly canManageRoster = true;
    public readonly canCreateCommandDraft = true;
    public readonly canClose = true;
    public readonly canReopen = false;

    public assertCanMutateTransactions(): void {
        // Allowed in open state
    }

    public assertCanMutateGroupMetadata(): void {
        // Allowed in open state
    }

    public assertCanMutateRoster(): void {
        // Allowed in open state
    }

    public assertCanCreateDraft(): void {
        // Allowed in open state
    }

    public assertCanTransitionToClosed(balances: Record<string, number>, force = false): void {
        if (force) return;
        const nonZero = getNonZeroBalances(balances);
        if (Object.keys(nonZero).length > 0) {
            throw new GroupNotSettledError(nonZero);
        }
    }
}

export class ClosedGroupState implements IGroupLifecycleState {
    public readonly status: GroupStatus = "closed";
    public readonly isClosed = true;
    public readonly isReadOnly = true;
    public readonly canEditTransactions = false;
    public readonly canEditGroupMetadata = false;
    public readonly canManageRoster = false;
    public readonly canCreateCommandDraft = false;
    public readonly canClose = false;
    public readonly canReopen = true;

    public assertCanMutateTransactions(): void {
        throw new GroupClosedError();
    }

    public assertCanMutateGroupMetadata(): void {
        throw new GroupClosedError();
    }

    public assertCanMutateRoster(): void {
        throw new GroupClosedError();
    }

    public assertCanCreateDraft(): void {
        throw new GroupClosedError();
    }

    public assertCanTransitionToClosed(): void {
        // Idempotent: already closed
    }
}

const OPEN_STATE = new OpenGroupState();
const CLOSED_STATE = new ClosedGroupState();

export function resolveGroupState(status?: GroupStatus | string | null): IGroupLifecycleState {
    return normalizeGroupStatus(status) === "closed" ? CLOSED_STATE : OPEN_STATE;
}
