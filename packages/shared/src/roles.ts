/** Business roles. A person may hold more than one. Login identity is stored separately. */
export const ROLES = [
  'teacher',
  'student',
  'parent',
  'cas_coordinator',
  'ee_coordinator',
  'supervisor',
  'admin',
  'ops_mailer',
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
