# ADR: Unified `_meta` Manifest Identity and `@qozara/cloud-sync` v2 Migration

## Status
Accepted

## Date
2026-11-27

## Context
Quozen previously depended on `@qozara/gdocs-schema` alongside `@qozara/cloud-sync` and `@qozara/cloud-sync-google` for Google Sheets schema validation, migrations, and Drive storage operations. Because document validation relied primarily on matching required tab names and Drive `properties` (`quozen_type`), two failure modes existed:
1. **Unrelated or Foreign Spreadsheets:** Selecting a personal spreadsheet or another Qozara application's spreadsheet via Google Picker could trigger repair/mutation attempts or surface confusing missing-tab errors.
2. **Drive Copy Friction (`File -> Make a copy`):** Copying a valid Quozen spreadsheet in the Google Drive UI preserves sheet tabs (including `_meta`) but strips custom Drive `properties`/`appProperties`, causing naive Drive-property checks to reject or misclassify legitimate copies.
3. **Custom User Formula Columns:** Writing full padded row arrays (`""`) could overwrite formulas or columns users added manually inside managed tabs.

## Decision
1. **Consolidate on `@qozara/cloud-sync@^2.0.0` and `@qozara/cloud-sync-google@^2.0.0`:**
   Remove `@qozara/gdocs-schema` and adopt the unified `SchemaEngine` / `GoogleValidationService` / `GoogleSheetsTabularDriver` stack.
2. **Enforce Canonical `_meta` Manifest Identity (Schema v5):**
   Upgrade `QuozenSchema` to `version: 5` with `identity: { appId: "quozen", docType: "group" }` and `migration_5` (`5_stamp_manifest_identity.ts`) stamping:
   - `qozara_manifest_version = "1"`
   - `app_id = "quozen"`
   - `doc_type = "group"`
   - `schema_version = "5"`
   - `schema_hash`
   - `origin_container_id`
3. **Hard-Reject `UNMANAGED` and `FOREIGN_APP` Documents:**
   `GroupRepository.validateQuozenSpreadsheet`, `importGroup`, `joinGroup`, `LedgerService`, and the webapp/API surface throw/handle `UnmanagedDocumentError` and `ForeignDocumentError` (HTTP `422` + read-only remediation notice) with zero spreadsheet mutations.
4. **Heal Drive UI Copies (`isForkedCopy`) & Preserve User Formula Columns:**
   Recognize verified copied Quozen sheets whose `origin_container_id !== containerId`, heal their manifest identity and Drive properties on import, and return `undefined` (instead of `""`) in `SheetDataMapper` for non-schema columns so `GoogleSheetsTabularDriver` leaves user-defined formulas and reordered headers untouched.

## Consequences
- Users can copy or inspect Quozen spreadsheets freely in Google Sheets and import them back safely.
- Custom formulas added alongside managed columns survive synchronization writes.
- Unrelated spreadsheets and foreign Qozara app spreadsheets are strictly protected against unintended writes or repair prompts.
