/**
 * better-auth integration for admin panel
 */

export interface AdminAuthConfig {
  provider: 'better-auth';
  adminRole?: string;
  adminCheck?: (user: unknown) => boolean | Promise<boolean>;
}

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

/**
 * Create auth guard for server routes
 */
export function createAuthGuard(config: AdminAuthConfig) {
  const { adminRole = 'admin', adminCheck } = config;

  return async (locals: Record<string, unknown>): Promise<{ authorized: boolean; user: unknown | null }> => {
    // Get session from better-auth
    const session = (locals as Record<string, unknown>).session;
    const user = (locals as Record<string, unknown>).user;

    if (!session || !user) {
      return { authorized: false, user: null };
    }

    // Check if user is admin
    const isAdmin = adminCheck 
      ? await adminCheck(user)
      : defaultAdminCheck(user, adminRole);

    return { authorized: isAdmin, user };
  };
}

/**
 * Type for admin session
 */
export interface AdminSession {
  user: {
    id: string;
    email: string;
    name?: string;
    role?: string;
    [key: string]: unknown;
  };
  session: {
    id: string;
    expiresAt: Date;
    [key: string]: unknown;
  };
}
