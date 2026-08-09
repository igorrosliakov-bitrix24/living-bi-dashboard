export function resolveDashboardEditAccess({ ownerId, user }) {
  if (!user?.id) {
    return { allowed: false, claimOwner: false };
  }

  if (ownerId) {
    return { allowed: ownerId === user.id, claimOwner: false };
  }

  return { allowed: user.role === "ADMIN", claimOwner: user.role === "ADMIN" };
}
