declare global {
  namespace App {
    interface Locals {
      user?: {
        id: string;
        email: string;
        name?: string;
        role?: string;
        /** Tenant courant. C'est la seule source du scoping côté admin. */
        organizationId: string;
      };
      organization?: {
        id: string;
        slug: string;
        name: string;
      };
    }
  }
}

export {};
