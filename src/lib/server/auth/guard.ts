/**
 * better-auth integration for admin panel
 */

/**
 * Default admin check - looks for role field
 */
export function defaultAdminCheck(user: unknown, adminRole: string = 'admin'): boolean {
  if (!user || typeof user !== 'object') return false;
  
  const u = user as Record<string, unknown>;
  
  // Check common role field names
  if (u.role === adminRole) return true;
  if (u.isAdmin === true) return true;
  if (Array.isArray(u.roles) && u.roles.includes(adminRole)) return true;
  
  return false;
}
