import { describe, it, expect } from "vitest";
import { GroupMembershipResolver } from "../../src/domain/GroupMembershipResolver";
import { Member } from "../../src/domain/models";
import { GroupCollaborator } from "../../src/domain/collaborator";

describe("GroupMembershipResolver", () => {
    const ownerCollaborator: GroupCollaborator = {
        id: "perm-owner",
        email: "alice@gmail.com",
        displayName: "Alice Smith",
        role: "owner"
    };

    const bobCollaborator: GroupCollaborator = {
        id: "perm-bob",
        email: "bob@gmail.com",
        displayName: "Bob Jones",
        role: "editor"
    };

    const charlieCollaborator: GroupCollaborator = {
        id: "perm-charlie",
        email: "charlie@gmail.com",
        displayName: "Charlie Brown",
        role: "editor"
    };

    it("resolves the 99% case: 1:1 personal accounts with matching emails", () => {
        const members: Member[] = [
            {
                userId: "user-alice",
                email: "alice@gmail.com",
                name: "Alice",
                role: "owner",
                joinedAt: new Date()
            },
            {
                userId: "user-bob",
                email: "bob@gmail.com",
                name: "Bob",
                role: "member",
                joinedAt: new Date()
            }
        ];

        const overview = GroupMembershipResolver.resolveParticipants({
            members,
            collaborators: [ownerCollaborator, bobCollaborator],
            accountManagers: {},
            accessMode: "restricted"
        });

        expect(overview.accounts).toHaveLength(2);
        expect(overview.accounts[0].kind).toBe("personal");
        expect(overview.accounts[0].managers).toHaveLength(1);
        expect(overview.accounts[0].managers[0].email).toBe("alice@gmail.com");
        expect(overview.accounts[0].managers[0].displayName).toBe("Alice Smith");

        expect(overview.accounts[1].kind).toBe("personal");
        expect(overview.accounts[1].managers[0].email).toBe("bob@gmail.com");
        expect(overview.unassignedCollaborators).toHaveLength(0);
    });

    it("resolves co-managed accounts where user C manages an account that already has user B's email", () => {
        const members: Member[] = [
            {
                userId: "user-alice",
                email: "alice@gmail.com",
                name: "Alice",
                role: "owner",
                joinedAt: new Date()
            },
            {
                userId: "user-bob",
                email: "bob@gmail.com",
                name: "Bob",
                role: "member",
                joinedAt: new Date()
            }
        ];

        const overview = GroupMembershipResolver.resolveParticipants({
            members,
            collaborators: [ownerCollaborator, bobCollaborator, charlieCollaborator],
            accountManagers: {
                "user-bob": ["bob@gmail.com", "charlie@gmail.com"]
            },
            accessMode: "restricted"
        });

        expect(overview.accounts).toHaveLength(2);
        const bobAccount = overview.accounts.find(a => a.member.userId === "user-bob")!;
        expect(bobAccount.kind).toBe("shared");
        expect(bobAccount.managers).toHaveLength(2);
        expect(bobAccount.managers.map(m => m.email)).toEqual(["bob@gmail.com", "charlie@gmail.com"]);
        expect(bobAccount.managers[1].displayName).toBe("Charlie Brown");

        // Charlie is NOT an unassigned collaborator because Charlie is co-managing Bob's account
        expect(overview.unassignedCollaborators).toHaveLength(0);
    });

    it("resolves shared family accounts (e.g. Garcia Family) with no individual email in members", () => {
        const members: Member[] = [
            {
                userId: "user-alice",
                email: "alice@gmail.com",
                name: "Alice",
                role: "owner",
                joinedAt: new Date()
            },
            {
                userId: "account-garcia",
                email: "",
                name: "Garcia Family",
                role: "member",
                joinedAt: new Date()
            }
        ];

        const overview = GroupMembershipResolver.resolveParticipants({
            members,
            collaborators: [ownerCollaborator, charlieCollaborator],
            accountManagers: {
                "account-garcia": ["charlie@gmail.com"]
            },
            accessMode: "restricted"
        });

        const garciaAccount = overview.accounts.find(a => a.member.userId === "account-garcia")!;
        expect(garciaAccount.kind).toBe("shared");
        expect(garciaAccount.managers).toHaveLength(1);
        expect(garciaAccount.managers[0].email).toBe("charlie@gmail.com");
        expect(garciaAccount.managers[0].displayName).toBe("Charlie Brown");
        expect(overview.unassignedCollaborators).toHaveLength(0);
    });

    it("resolves offline accounts with no matching cloud identity", () => {
        const members: Member[] = [
            {
                userId: "user-alice",
                email: "alice@gmail.com",
                name: "Alice",
                role: "owner",
                joinedAt: new Date()
            },
            {
                userId: "user-david",
                email: "",
                name: "David",
                role: "member",
                joinedAt: new Date()
            }
        ];

        const overview = GroupMembershipResolver.resolveParticipants({
            members,
            collaborators: [ownerCollaborator],
            accountManagers: {},
            accessMode: "restricted"
        });

        const davidAccount = overview.accounts.find(a => a.member.userId === "user-david")!;
        expect(davidAccount.kind).toBe("offline");
        expect(davidAccount.managers).toHaveLength(0);
    });

    it("detects unassigned cloud collaborators who have access but no linked ledger account", () => {
        const members: Member[] = [
            {
                userId: "user-alice",
                email: "alice@gmail.com",
                name: "Alice",
                role: "owner",
                joinedAt: new Date()
            }
        ];

        const overview = GroupMembershipResolver.resolveParticipants({
            members,
            collaborators: [ownerCollaborator, charlieCollaborator],
            accountManagers: {},
            accessMode: "restricted"
        });

        expect(overview.accounts).toHaveLength(1);
        expect(overview.unassignedCollaborators).toHaveLength(1);
        expect(overview.unassignedCollaborators[0].email).toBe("charlie@gmail.com");
    });

    it("formats manager descriptions accurately for 1, 2, and 3+ managers", () => {
        const single = GroupMembershipResolver.formatManagers([charlieCollaborator]);
        expect(single).toBe("Managed by Charlie Brown (charlie@gmail.com)");

        const dual = GroupMembershipResolver.formatManagers([bobCollaborator, charlieCollaborator]);
        expect(dual).toBe("Managed by Bob Jones (bob@gmail.com) and Charlie Brown (charlie@gmail.com)");

        const triple = GroupMembershipResolver.formatManagers([
            ownerCollaborator,
            bobCollaborator,
            charlieCollaborator
        ]);
        expect(triple).toBe("Managed by Alice Smith, Bob Jones, and Charlie Brown (3 managers)");
    });
});
