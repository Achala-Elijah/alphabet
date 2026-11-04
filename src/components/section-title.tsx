export default function SectionTitle({ children, action }: { children: React.ReactNode; action?: string }) {
  return <div className="section-title"><h2>{children}</h2>{action && <button>{action}</button>}</div>;
}
