"use client";

import { Download, Eye, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { formatCustomerAmount, currencySymbol } from "@/lib/currency";

type User = {
  id: string;
  username: string;
  email: string | null;
  phone: string;
  balance: number;
  currency: string;
  created_at: string;
};

export default function UsersTable({ users }: { users: User[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const filteredUsers = useMemo(() => users.filter((user) =>
    `${user.username} ${user.email || ""} ${user.phone}`.toLowerCase().includes(query.toLowerCase())
  ), [users, query]);
  function exportCsv() {
    const headers = ["id", "username", "email", "phone", "wallet_balance", "status", "joined"];
    const escape = (value: string | number | null | undefined) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const body = filteredUsers.map((user) => [
      user.id,
      user.username,
      user.email || "",
      user.phone,
      formatCustomerAmount(user.balance, user.currency),
      "Active",
      new Date(user.created_at).toISOString()
    ].map(escape).join(","));
    const csv = [headers.map(escape).join(","), ...body].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  // Tapping anywhere on the row opens the customer — unless the tap landed on
  // a real link or button inside it (those handle themselves).
  function openUser(event: React.MouseEvent<HTMLTableRowElement>, id: string) {
    if ((event.target as HTMLElement).closest("a, button")) return;
    router.push(`/sub-admin/users/${id}`);
  }

  return <>
    <div className="toolbar">
      <div className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, email or phone..." aria-label="Search users" /></div>
      <button type="button" className="secondary-button" onClick={exportCsv} disabled={filteredUsers.length === 0}><Download size={17} /> Export</button>
    </div>
    <section className="admin-card table-card"><div className="table-wrap"><table><thead><tr><th>User</th><th>Phone</th><th>Wallet balance</th><th>Status</th><th>Joined</th><th>Details</th></tr></thead><tbody>
      {filteredUsers.map((user) => <tr key={user.id} className="user-row-clickable" onClick={(event) => openUser(event, user.id)}><td><Link className="user-table-link" href={`/sub-admin/users/${user.id}`}><div className="user-cell"><span className="mini-avatar">{user.username.slice(0, 2).toUpperCase()}</span><div><strong>{user.username}</strong><small>{user.email || "No email added"}</small></div></div></Link></td><td>{user.phone}</td><td className="amount-cell">{formatCustomerAmount(user.balance, user.currency)}</td><td><span className="status active">Active</span></td><td>{new Date(user.created_at).toLocaleDateString()}</td><td><Link className="user-details-link" href={`/sub-admin/users/${user.id}`}><Eye size={14} /> <span>View details</span></Link></td></tr>)}
      {filteredUsers.length === 0 && <tr><td colSpan={6} className="empty-table">No users found.</td></tr>}
    </tbody></table></div></section>
  </>;
}
