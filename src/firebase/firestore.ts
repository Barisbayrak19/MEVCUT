import { doc, getDoc } from "firebase/firestore";
import { db } from "./config";
import type { UserProfile } from "../types/user";

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snapshot = await getDoc(doc(db, "users", uid));
  if (!snapshot.exists()) return null;

  return {
    uid,
    ...(snapshot.data() as Omit<UserProfile, "uid">),
  };
}
