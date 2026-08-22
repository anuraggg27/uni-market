import { Home, ListPlus, MessageCircle, Search, UserRound } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { Navbar } from './Navbar';

const mobileLinks = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/browse', label: 'Browse', icon: Search },
  { to: '/sell', label: 'Sell', icon: ListPlus },
  { to: '/chats', label: 'Chats', icon: MessageCircle },
  { to: '/profile', label: 'Profile', icon: UserRound },
];

export function Layout() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Navbar />
      <main id="main">
        <Outlet />
      </main>
      <nav className="mobile-nav" aria-label="Mobile primary">
        {mobileLinks.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <footer>
        <div>
          <strong>Uni Market</strong>
          <p>Buy and sell locally. Payments and delivery happen independently.</p>
        </div>
        <nav aria-label="Footer">
          <Link to="/support">Support</Link>
          <Link to="/leaderboard">Top sellers</Link>
          <Link to="/settings">Settings</Link>
        </nav>
      </footer>
    </div>
  );
}
