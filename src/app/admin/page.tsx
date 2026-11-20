import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, isAdminSession } from "@/lib/auth";
import AdminDashboard from "./AdminDashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const store = await cookies();
  if (!isAdminSession(store.get(ADMIN_COOKIE)?.value)) {
    redirect("/admin/login");
  }
  return <AdminDashboard />;
}
