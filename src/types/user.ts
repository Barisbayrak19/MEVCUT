export type UserRole = "admin" | "teacher" | "parent" | "student";

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  role: UserRole;
  organizationId: string;
  active: boolean;
}
