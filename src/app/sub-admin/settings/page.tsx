import AdminShell from "@/components/admin-shell";
import { Bell, ShieldCheck, Globe, Save } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user ? await supabase.from("profiles").select("username, phone").eq("id", user.id).single() : { data: null };
  return <AdminShell title="Settings" description="Manage your sub-admin preferences and workspace settings.">
    <div className="settings-grid"><section className="admin-card settings-card"><h2><Bell size={19}/> Notifications</h2><p>Notification controls are ready for a connected notification service.</p>{["New user registrations","Deposits and withdrawals","Partner activity","Match status updates"].map((x)=><label className="toggle-row" key={x}><span>{x}</span><input type="checkbox" defaultChecked/><i/></label>)}</section><section className="admin-card settings-card"><h2><ShieldCheck size={19}/> Account preferences</h2><p>Authenticated staff profile information.</p><label className="form-label">Display name<input defaultValue={profile?.username || ""} readOnly /></label><label className="form-label">Phone number<input defaultValue={profile?.phone || ""} readOnly /></label><label className="form-label">Language<select defaultValue="English"><option>English</option></select></label><button className="primary-button" disabled><Save size={16}/> Save changes</button></section></div>
  </AdminShell>;
}
