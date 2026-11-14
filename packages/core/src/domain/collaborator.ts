import type {
    CollaboratorRole,
    GroupAccessMode,
    GroupAccountKind,
    GroupCollaborator,
} from "@qozara/cloud-sync";
import { Member } from "./models";

export type {
    CollaboratorRole,
    GroupAccessMode,
    GroupAccountKind,
    GroupCollaborator,
};

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
