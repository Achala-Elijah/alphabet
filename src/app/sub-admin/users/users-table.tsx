"use client";

import { Download, Eye, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

type User = {
  id: string;
  username: string;
  email: string | null;
  phone: string;
  balance: number;
  created_at: string;
};

export default function UsersTable({ users }: { users: User[] }) {
  const [query, setQuery] = useState("");
  const filteredUsers = useMemo(() => users.filter((user) =>
    `${user.username} ${user.email || ""} ${user.phone}`.toLowerCase().includes(query.toLowerCase())
  ), [users, query]);

  return <>
    <div className="toolbar">
      <div className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, email or phone..." /></div>
      <button type="button" className="secondary-button"><Download size={17} /> Export</button>
    </div>
    <section className="admin-card table-card"><div className="table-wrap"><table><thead><tr><th>User</th><th>Phone</th><th>Wallet balance</th><th>Status</th><th>Joined</th><th>Details</th></tr></thead><tbody>
      {filteredUsers.map((user) => <tr key={user.id} className="user-row-clickable"><td><Link className="user-table-link" href={`/sub-admin/users/${user.id}`}><div className="user-cell"><span className="mini-avatar">{user.username.slice(0, 2).toUpperCase()}</span><div><strong>{user.username}</strong><small>{user.email || "No email added"}</small></div></div></Link></td><td>{user.phone}</td><td className="amount-cell">GH₵ {Number(user.balance || 0).toFixed(2)}</td><td><span className="status active">Active</span></td><td>{new Date(user.created_at).toLocaleDateString()}</td><td><Link className="user-details-link" href={`/sub-admin/users/${user.id}`}><Eye size={14} /> <span>View details</span></Link></td></tr>)}
      {filteredUsers.length === 0 && <tr><td colSpan={6} className="empty-table">No users found.</td></tr>}
    </tbody></table></div></section>
  </>;
}
