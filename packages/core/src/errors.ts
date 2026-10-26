export class ConflictError extends Error {
    constructor(message = "Data has been modified by another user.") {
        super(message);
        this.name = "ConflictError";
    }
}

export class NotFoundError extends Error {
    constructor(message = "Resource not found.") {
        super(message);
        this.name = "NotFoundError";
    }
}

export class SchemaCorruptedError extends Error {
    constructor(message = "The underlying spreadsheet schema is missing required structure.") {
        super(message);
        this.name = "SchemaCorruptedError";
    }
}

export class SchemaUpgradeRequiredError extends Error {
    constructor(message = "The underlying spreadsheet schema must be upgraded to continue.") {
        super(message);
        this.name = "SchemaUpgradeRequiredError";
    }
}

export class SchemaIncompatibleError extends Error {
    constructor(message = "The underlying spreadsheet schema was created or upgraded by a newer version of Quozen. Please update or reinstall the app.") {
        super(message);
        this.name = "SchemaIncompatibleError";
    }
}

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

export class TableNotFoundError extends Error {
    constructor(public readonly tabName: string, message?: string) {
        super(message || `Tabular sheet "${tabName}" not found in spreadsheet.`);
        this.name = "TableNotFoundError";
    }
}

export class OfflineOperationError extends Error {
    public readonly action?: string;
    constructor(message: string = "This operation requires an internet connection.", action?: string) {
        super(message);
        this.name = "OfflineOperationError";
        this.action = action;
        Object.setPrototypeOf(this, OfflineOperationError.prototype);
    }
}

export class GroupFileUnavailableError extends Error {
    constructor(
        public readonly groupId: string,
        public readonly groupName?: string,
        public readonly reason: "trashed" | "deleted" = "deleted",
        message = "The underlying spreadsheet file is no longer available in Google Drive."
    ) {
        super(message);
        this.name = "GroupFileUnavailableError";
        Object.setPrototypeOf(this, GroupFileUnavailableError.prototype);
    }
}
