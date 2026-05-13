import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import Topbar from "@/components/app/topbar";
import { Role } from "@prisma/client";
import AdminUserList from "@/components/admin/user-list";

export const dynamic = "force-dynamic";

export default async function AdminUsers() {
  const user = await requireSession({ role: Role.ADMIN });
  const users = await db.user.findMany({
    select: {
      id: true,
      username: true,
      role: true,
      isActive: true,
      createdAt: true,
      lastLoginAt: true,
      lockedUntil: true,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return (
    <>
      <Topbar username={user.username} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-3xl font-semibold">Users</h1>
        <AdminUserList
          initial={users.map((u) => ({
            ...u,
            createdAt: u.createdAt.toISOString(),
            lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
            lockedUntil: u.lockedUntil?.toISOString() ?? null,
          }))}
        />
      </main>
    </>
  );
}
