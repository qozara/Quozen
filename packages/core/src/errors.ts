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
