import { Member } from "./models";
import {
    GroupCollaborator,
    ResolvedGroupAccount,
    GroupParticipantsOverview,
    AccountManagersMap,
    GroupAccessMode,
    GroupAccountKind
} from "./collaborator";

export class GroupMembershipResolver {
    public static resolveParticipants(params: {
        members: Member[];
        collaborators: GroupCollaborator[];
        accountManagers: AccountManagersMap;
        accessMode?: GroupAccessMode;
    }): GroupParticipantsOverview {
        const { members, collaborators, accountManagers, accessMode = "restricted" } = params;

        const collabByEmail = new Map<string, GroupCollaborator>();
        for (const c of collaborators) {
            if (c.email) {
                collabByEmail.set(c.email.trim().toLowerCase(), c);
            }
        }

        const resolveCanonicalAccountId = (rawKey: string): string => {
            const exact = members.find(m => m.userId === rawKey);
            if (exact) return exact.userId;
            const normKey = rawKey.trim().toLowerCase();
            const byEmail = members.find(m => m.email && m.email.trim().toLowerCase() === normKey);
            if (byEmail) return byEmail.userId;
            const byUserIdInsensitive = members.find(m => m.userId.trim().toLowerCase() === normKey);
            if (byUserIdInsensitive) return byUserIdInsensitive.userId;
            return rawKey;
        };

        // Normalize accountManagers keys (handling pre-migration email keys) and identify explicit email bindings
        const normalizedManagers = new Map<string, string[]>();
        const explicitlyBoundEmails = new Map<string, string>(); // email -> canonicalAccountId
        for (const [rawAccountId, emails] of Object.entries(accountManagers)) {
            if (!Array.isArray(emails)) continue;
            const canonicalAccountId = resolveCanonicalAccountId(rawAccountId);
            const existing = normalizedManagers.get(canonicalAccountId) || [];
            for (const em of emails) {
                const trimmed = em?.trim();
                if (!trimmed) continue;
                const norm = trimmed.toLowerCase();
                explicitlyBoundEmails.set(norm, canonicalAccountId);
                if (!existing.some(e => e.toLowerCase() === norm)) {
                    existing.push(trimmed);
                }
            }
            if (existing.length > 0) {
                normalizedManagers.set(canonicalAccountId, existing);
            }
        }

        const resolvedAccounts: ResolvedGroupAccount[] = [];
        const allAssignedEmails = new Set<string>();

        for (const member of members) {
            const rawManagerEmails = normalizedManagers.get(member.userId) || [];
            const managerEmails: string[] = [...rawManagerEmails];

            if (member.email && member.email.trim()) {
                const trimmedMemberEmail = member.email.trim();
                const normEmail = trimmedMemberEmail.toLowerCase();
                // Include member.email if this user has NOT explicitly mapped themselves to a different account
                const boundTo = explicitlyBoundEmails.get(normEmail);
                if (!boundTo || boundTo === member.userId) {
                    if (!managerEmails.some(e => e.toLowerCase() === normEmail)) {
                        managerEmails.unshift(trimmedMemberEmail);
                    }
                }
            }

            const managers: GroupCollaborator[] = managerEmails.map(email => {
                const norm = email.toLowerCase();
                const matched = collabByEmail.get(norm);
                if (matched) return matched;

                return {
                    id: `virtual-${norm}`,
                    email,
                    displayName: email.split("@")[0] || email,
                    role: "editor"
                };
            });

            for (const m of managers) {
                if (m.email) allAssignedEmails.add(m.email.toLowerCase());
            }

            let kind: GroupAccountKind = "personal";
            if (managers.length === 0) {
                kind = !member.email ? "offline" : "personal";
            } else if (managers.length === 1) {
                const single = managers[0];
                const matchesMemberEmail = Boolean(
                    member.email && single.email.toLowerCase() === member.email.trim().toLowerCase()
                );
                kind = matchesMemberEmail ? "personal" : "shared";
            } else {
                kind = "shared";
            }

            resolvedAccounts.push({
                member,
                kind,
                managers
            });
        }

        const unassignedCollaborators = collaborators.filter(
            c => !c.email || !allAssignedEmails.has(c.email.trim().toLowerCase())
        );

        return {
            accounts: resolvedAccounts,
            collaborators,
            unassignedCollaborators,
            accessMode
        };
    }

    public static formatManagers(managers: GroupCollaborator[]): string {
        if (!managers || managers.length === 0) return "";

        if (managers.length === 1) {
            const m = managers[0];
            const name = m.displayName?.trim();
            return name && name.toLowerCase() !== m.email.toLowerCase()
                ? `Managed by ${name} (${m.email})`
                : `Managed by ${m.email}`;
        }

        if (managers.length === 2) {
            const m1 = managers[0];
            const m2 = managers[1];
            const n1 = m1.displayName?.trim() && m1.displayName.toLowerCase() !== m1.email.toLowerCase()
                ? `${m1.displayName} (${m1.email})`
                : m1.email;
            const n2 = m2.displayName?.trim() && m2.displayName.toLowerCase() !== m2.email.toLowerCase()
                ? `${m2.displayName} (${m2.email})`
                : m2.email;
            return `Managed by ${n1} and ${n2}`;
        }

        const names = managers.map(m => m.displayName?.trim() || m.email);
        const allButLast = names.slice(0, -1).join(", ");
        const last = names[names.length - 1];
        return `Managed by ${allButLast}, and ${last} (${managers.length} managers)`;
    }
}
