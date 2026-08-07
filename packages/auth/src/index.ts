export const MembershipRoles = [
  "PLATFORM_SUPER_ADMIN",
  "MERCHANT_OWNER",
  "MERCHANT_ADMIN",
  "FINANCE_MANAGER",
  "SALES_MANAGER",
  "SALES_AGENT",
  "INVENTORY_MANAGER",
  "FULFILMENT_AGENT",
  "ACCOUNTANT",
  "READ_ONLY_AUDITOR",
] as const;

export type MembershipRole = (typeof MembershipRoles)[number];

export const Permissions = [
  "merchant:read",
  "merchant:manage",
  "membership:read",
  "membership:manage",
  "order:read",
  "order:write",
  "payment:read",
  "payment:allocate",
  "inventory:read",
  "inventory:write",
  "report:read",
  "audit:read",
  "platform:admin",
] as const;

export type Permission = (typeof Permissions)[number];

export type AuthenticatedTenantContext = {
  userId: string;
  merchantId: string;
  membershipId: string;
  role: MembershipRole;
  permissions: Permission[];
};

const ROLE_PERMISSIONS: Record<MembershipRole, Permission[]> = {
  PLATFORM_SUPER_ADMIN: [...Permissions],
  MERCHANT_OWNER: [
    "merchant:read",
    "merchant:manage",
    "membership:read",
    "membership:manage",
    "order:read",
    "order:write",
    "payment:read",
    "payment:allocate",
    "inventory:read",
    "inventory:write",
    "report:read",
    "audit:read",
  ],
  MERCHANT_ADMIN: [
    "merchant:read",
    "membership:read",
    "order:read",
    "order:write",
    "payment:read",
    "payment:allocate",
    "inventory:read",
    "inventory:write",
    "report:read",
    "audit:read",
  ],
  FINANCE_MANAGER: ["merchant:read", "order:read", "payment:read", "payment:allocate", "report:read", "audit:read"],
  SALES_MANAGER: ["merchant:read", "membership:read", "order:read", "order:write", "payment:read", "report:read"],
  SALES_AGENT: ["merchant:read", "order:read", "order:write", "payment:read"],
  INVENTORY_MANAGER: ["merchant:read", "order:read", "inventory:read", "inventory:write", "report:read"],
  FULFILMENT_AGENT: ["merchant:read", "order:read", "order:write", "inventory:read"],
  ACCOUNTANT: ["merchant:read", "order:read", "payment:read", "report:read", "audit:read"],
  READ_ONLY_AUDITOR: ["merchant:read", "order:read", "payment:read", "inventory:read", "report:read", "audit:read"],
};

export function permissionsForRole(role: MembershipRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function hasPermission(context: AuthenticatedTenantContext, permission: Permission): boolean {
  return context.permissions.includes(permission);
}

export function assertPermission(context: AuthenticatedTenantContext, permission: Permission): void {
  if (!hasPermission(context, permission)) {
    throw authorizationError("Permission denied");
  }
}

export function assertTenantAccess(context: AuthenticatedTenantContext, resourceMerchantId: string): void {
  if (context.role === "PLATFORM_SUPER_ADMIN") return;
  if (context.merchantId !== resourceMerchantId) {
    throw authorizationError("Tenant access denied");
  }
}

export function isMembershipRole(value: string): value is MembershipRole {
  return MembershipRoles.includes(value as MembershipRole);
}

export function authorizationError(message: string): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = 403;
  error.code = "TENANT_ACCESS_DENIED";
  return error;
}
