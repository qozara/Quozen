export {
    ConflictError,
    NotFoundError,
    SchemaCorruptedError,
    SchemaUpgradeRequiredError,
    SchemaIncompatibleError,
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
