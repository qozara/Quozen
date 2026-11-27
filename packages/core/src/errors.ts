export {
    ConflictError,
    NotFoundError,
    SchemaCorruptedError,
    SchemaUpgradeRequiredError,
    SchemaIncompatibleError,
    UnmanagedDocumentError,
    ForeignDocumentError,
    TableNotFoundError,
    OfflineOperationError,
    GroupFileUnavailableError,
} from "@qozara/cloud-sync";

export class InvalidCategoryError extends Error {
    constructor(message = "Invalid category.") {
        super(message);
        this.name = "InvalidCategoryError";
    }
}

export class CategoryInUseError extends Error {
    constructor(message = "Category is in use by one or more expenses.") {
        super(message);
        this.name = "CategoryInUseError";
    }
}

export class GroupClosedError extends Error {
    constructor(message = "Group is closed and read-only. Re-open the group to make changes.") {
        super(message);
        this.name = "GroupClosedError";
    }
}

export class GroupNotSettledError extends Error {
    public readonly nonZeroBalances: Record<string, number>;

    constructor(
        nonZeroBalances: Record<string, number>,
        message = "Group has non-zero account balances. Pass force=true to close anyway."
    ) {
        super(message);
        this.name = "GroupNotSettledError";
        this.nonZeroBalances = nonZeroBalances;
    }
}
