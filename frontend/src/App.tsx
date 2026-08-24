import { NavLink, Outlet } from "react-router-dom";

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" />
          Call Router
        </div>
        <nav className="tabs">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
            Call
          </NavLink>
          <NavLink to="/onboarding" className={({ isActive }) => (isActive ? "active" : "")}>
            Onboarding
          </NavLink>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
