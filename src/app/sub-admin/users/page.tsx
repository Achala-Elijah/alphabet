import AdminShell from "@/components/admin-shell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import UsersTable from "./users-table";

export default async function UsersPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user: staffUser } } = await supabase.auth.getUser();
  const { data: staffProfile } = staffUser ? await supabase.from("profiles").select("role").eq("id", staffUser.id).single() : { data: null };
  let usersQuery = supabase.from("customer_accounts").select("id, username, email, phone, balance, currency, created_at").order("created_at", { ascending: false });
  if (staffProfile?.role === "sub_admin" && staffUser) usersQuery = usersQuery.eq("referred_by", staffUser.id);
  const { data: users } = await usersQuery;
  return <AdminShell title="Users" description="Manage customer accounts and review user activity.">
    <UsersTable users={users || []} />
  </AdminShell>;
}
