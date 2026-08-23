import { Home, ListPlus, MessageCircle, Search, UserRound } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Navbar } from './Navbar';

const mobileLinks = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/browse', label: 'Browse', icon: Search },
  { to: '/sell', label: 'Sell', icon: ListPlus },
  { to: '/chats', label: 'Chats', icon: MessageCircle },
  { to: '/profile', label: 'Profile', icon: UserRound },
];

export function Layout() {
  const { pathname } = useLocation();
  const isChatRoute = pathname === '/chats' || pathname.startsWith('/chats/');
  const isConversationRoute = pathname.startsWith('/chats/');

  return (
    <div
      className={`app-shell ${isChatRoute ? 'chat-layout' : ''} ${isConversationRoute ? 'chat-conversation-layout' : ''}`}
    >
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
      <footer className="site-footer">
        <div className="site-footer-inner">
          <div className="site-footer-top">
            <div className="site-footer-intro">
              <p>
                <strong>Buy and sell locally.</strong>
                <span>A student marketplace built for campus life.</span>
              </p>
            </div>

            <nav className="site-footer-columns" aria-label="Footer">
              <div>
                <h2>Marketplace</h2>
                <Link to="/browse">Browse</Link>
                <Link to="/sell">Sell</Link>
                <Link to="/saved">Saved</Link>
                <Link to="/my-listings">My listings</Link>
              </div>
              <div>
                <h2>Community</h2>
                <Link to="/chats">Chats</Link>
                <Link to="/notifications">Notifications</Link>
                <Link to="/leaderboard">Top sellers</Link>
              </div>
              <div>
                <h2>Account &amp; help</h2>
                <Link to="/profile">Profile</Link>
                <Link to="/support">Support</Link>
                <Link to="/settings">Settings</Link>
              </div>
            </nav>
          </div>

          <div className="site-footer-utility">
            <span>� {new Date().getFullYear()} Uni Market</span>
            <nav aria-label="Footer utility">
              <Link to="/support">Support</Link>
              <Link to="/leaderboard">Top sellers</Link>
              <Link to="/settings">Settings</Link>
            </nav>
          </div>

          <Link className="site-footer-wordmark" to="/" aria-label="Uni Market home">
            <span>Uni</span><span>Market</span>
          </Link>
        </div>
      </footer>
    </div>
  );
}
