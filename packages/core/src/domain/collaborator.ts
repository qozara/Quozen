import { Member } from "./models";

export type CollaboratorRole = "owner" | "editor" | "viewer";
export type GroupAccessMode = "public" | "restricted";
export type GroupAccountKind = "personal" | "shared" | "offline";

export interface GroupCollaborator {
    id: string;
    email: string;
    displayName: string;
    avatarUrl?: string;
    role: CollaboratorRole;
}

export interface ResolvedGroupAccount {
    member: Member;
    kind: GroupAccountKind;
    managers: GroupCollaborator[];
}

export interface GroupParticipantsOverview {
    accounts: ResolvedGroupAccount[];
    collaborators: GroupCollaborator[];
    unassignedCollaborators: GroupCollaborator[];
    accessMode: GroupAccessMode;
}

export type AccountManagersMap = Record<string, string[]>;
