import type {
    CloudGroupCatalogDriver,
    CloudAccessControlDriver,
    CloudContainerMetadata
} from "./types";
import type { IStorageLayer } from "../infrastructure/IStorageLayer";
import type { GroupCollaborator, GroupAccessMode, CollaboratorRole } from "../domain/collaborator";
import { isNetworkError } from "./CompositeCloudSyncProvider";

export class StorageLayerCatalogAndAclDriver implements CloudGroupCatalogDriver, CloudAccessControlDriver {
    public id = "storage-layer-catalog-acl";
    public name = "Storage Layer Catalog & ACL Driver";

    constructor(
        private storage: IStorageLayer,
        private currentUserEmail?: string
    ) {}

    // --- CloudGroupCatalogDriver ---

    async listGroupContainers(): Promise<CloudContainerMetadata[]> {
        const files = await this.storage.listFiles(
            `properties has { key='quozen_type' and value='group' } and trashed = false`
        );
        const normUserEmail = (this.currentUserEmail || "").trim().toLowerCase();
        return (files || []).map((file: any) => ({
            id: file.id,
            name: file.name,
            isOwner: Boolean(
                (normUserEmail && file.owners?.some((o: any) => (o.emailAddress || "").toLowerCase() === normUserEmail)) ||
                file.capabilities?.canDelete
            ),
            lastAccessed: file.createdTime,
            createdTime: file.createdTime,
            properties: file.properties || {},
            owners: file.owners,
            capabilities: file.capabilities
        }));
    }

    async getGroupContainer(groupId: string): Promise<CloudContainerMetadata | null> {
        try {
            const file = await this.storage.getFile(groupId, {
                fields: "id,name,properties,owners,capabilities,trashed,createdTime,modifiedTime"
            });
            if (!file || file.trashed) return null;
            const normUserEmail = (this.currentUserEmail || "").trim().toLowerCase();
            return {
                id: file.id,
                name: file.name,
                isOwner: Boolean(
                    (normUserEmail && file.owners?.some((o: any) => (o.emailAddress || "").toLowerCase() === normUserEmail)) ||
                    file.capabilities?.canDelete
                ),
                lastAccessed: file.createdTime,
                createdTime: file.createdTime,
                properties: file.properties || {},
                owners: file.owners,
                capabilities: file.capabilities
            };
        } catch {
            return null;
        }
    }

    async createGroupContainer(
        title: string,
        sheetTitles: string[],
        properties?: Record<string, string>
    ): Promise<string> {
        return this.storage.createSpreadsheet(title, sheetTitles, properties);
    }

    async updateGroupContainer(
        groupId: string,
        metadata: { name?: string; properties?: Record<string, string> }
    ): Promise<void> {
        const payload: Record<string, any> = {};
        if (metadata.name !== undefined) payload.name = metadata.name;
        if (metadata.properties !== undefined) payload.properties = metadata.properties;
        await this.storage.updateFile(groupId, payload);
    }

    async deleteGroupContainer(groupId: string): Promise<void> {
        await this.storage.deleteFile(groupId);
    }

    async checkContainerHealth(groupId: string): Promise<{ available: boolean; reason?: "trashed" | "deleted" }> {
        const isOffline = typeof globalThis !== "undefined" && (globalThis as any).navigator?.onLine === false;
        if (isOffline) {
            return { available: true };
        }
        try {
            const meta = await this.storage.getFile(groupId, { fields: "id,name,trashed" });
            if (meta?.trashed) {
                return { available: false, reason: "trashed" };
            }
            return { available: true };
        } catch (err: any) {
            const msg = (err?.message || "").toLowerCase();
            if (msg.includes("404") || msg.includes("not found") || msg.includes("410") || err?.name === "NotFoundError") {
                return { available: false, reason: "deleted" };
            }
            if (isNetworkError(err)) {
                return { available: true };
            }
            throw err;
        }
    }

    // --- CloudAccessControlDriver ---

    async listCollaborators(groupId: string): Promise<GroupCollaborator[]> {
        try {
            const raw = await this.storage.listPermissions(groupId);
            return (raw || [])
                .filter((p: any) => p.type === "user" || p.role === "owner" || (p.emailAddress && p.type !== "anyone"))
                .map((p: any) => {
                    const email = p.emailAddress || "";
                    let role: CollaboratorRole = "editor";
                    if (p.role === "owner") role = "owner";
                    else if (p.role === "reader" || p.role === "viewer") role = "viewer";

                    return {
                        id: p.id || `perm-${email}`,
                        email,
                        displayName: p.displayName || (email ? email.split("@")[0] : "User"),
                        avatarUrl: p.photoLink,
                        role
                    };
                });
        } catch (err) {
            console.warn("[StorageLayerCatalogAndAclDriver] Failed to list group collaborators:", err);
            return [];
        }
    }

    async grantAccess(
        groupId: string,
        email: string,
        role: "editor" | "viewer" = "editor"
    ): Promise<{ displayName?: string }> {
        const sheetsRole = role === "viewer" ? "reader" : "writer";
        const perm = await this.storage.createPermission(groupId, sheetsRole, "user", email);
        return { displayName: perm?.displayName };
    }

    async revokeAccess(groupId: string, collaboratorIdOrEmail: string): Promise<void> {
        await this.storage.deletePermission(groupId, collaboratorIdOrEmail);
    }

    async getAccessMode(groupId: string): Promise<GroupAccessMode> {
        try {
            const permissions = await this.storage.listPermissions(groupId);
            const publicPerm = permissions.find((p: any) => p.type === "anyone");
            return publicPerm ? "public" : "restricted";
        } catch (e) {
            console.error("[StorageLayerCatalogAndAclDriver] Failed to get permissions", e);
            return "restricted";
        }
    }

    async setAccessMode(groupId: string, mode: GroupAccessMode): Promise<void> {
        if (mode === "public") {
            await this.storage.createPermission(groupId, "writer", "anyone");
        } else {
            const permissions = await this.storage.listPermissions(groupId);
            const publicPerm = permissions.find((p: any) => p.type === "anyone");
            if (publicPerm) {
                await this.storage.deletePermission(groupId, publicPerm.id);
            }
        }
    }
}
