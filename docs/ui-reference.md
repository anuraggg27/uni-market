# UI reference research

Mobbin was inspected before implementation. The references informed interaction patterns only; no complete screen, artwork, logo or brand identity was copied.

## References and selected patterns

- Marketplace home/browse: [Faire](https://mobbin.com/screens/dc2e1832-4d36-4a34-a263-3e7ba4aaaf5c), [Etsy](https://mobbin.com/screens/615bac1d-8899-4974-a6d2-d9d471b68661), and Depop. Selected a prominent search field, compact categories, dense readable cards and product-first content. This is faster for students than a marketing hero.
- Search/filtering: [Faire](https://mobbin.com/screens/7c0ac947-8ea5-48e8-b61d-9f63ccc18140), Unity and Etsy. Selected a small set of visible filters and a familiar sort selector; rejected enterprise faceting and saved-search machinery.
- Product detail: [Depop](https://mobbin.com/screens/a52ff1a4-d55a-48d6-a79d-6ec38439bd52), [Nextdoor](https://mobbin.com/screens/b87d4252-ce28-4b65-8dfc-ea62b011f85b), and Turo. Selected image-first layout, price/condition/location hierarchy, concise seller trust summary and one primary contact action.
- Sell and upload: [Nextdoor](https://mobbin.com/flows/e1bd32fb-c68c-4ae7-8b65-16e47d05571c), [Vinted](https://mobbin.com/flows/f6d5c7c8-cc36-4fdb-9896-e6e93476f22e), and [Vestiaire Collective](https://mobbin.com/flows/af2aced0-b3e0-4894-ad95-079d050b1de2). Selected a single structured page with immediate image previews, conditional pricing and clear moderation copy. Rejected a long wizard because the field count remains manageable.
- Inbox/chat: [Etsy mobile chat](https://mobbin.com/screens/8ec96e89-bd52-4b22-a335-77e9104cb2f3), [eBay listing chat](https://mobbin.com/screens/1ffce781-c643-4728-895c-a322433564c0), [Vestiaire Collective chat](https://mobbin.com/screens/3c373635-7634-4552-b66c-298c89500d3d), [Substack desktop inbox](https://mobbin.com/screens/d64f9410-3149-4d44-b828-b06a6a51d84e) and [Reddit desktop chat](https://mobbin.com/screens/03c662bf-1295-4e48-871f-5436c65f79c6). Selected a dense desktop split view, focused full-height mobile conversation, slim product context header, restrained bubbles, persistent low-profile composer and an unobtrusive safety line. The active chat re-subscribes after reconnect, follows new messages only when the reader is near the bottom and otherwise offers a “New messages” jump control. Rejected oversized profile headers, attachment trays, offer bars and circular icon-only send controls because they consume space or imply unsupported features.
- Saved items: [Etsy](https://mobbin.com/screens/284feda2-3f0e-433e-9b22-044adf47621f) and Shop. Selected the same product grid with honest lifecycle badges rather than a separate collection system.
- Seller profiles and reviews: [Etsy profile](https://mobbin.com/screens/ec3639e9-4a16-4ec3-9e19-4d1e9173f731), [Etsy ratings](https://mobbin.com/screens/92bbabb7-138e-49f9-9137-b55986efa5f4), Fiverr and Faire. Selected a small reputation summary, current listings and verified-transaction review stream; rejected revenue, follower and gamification widgets.
- Listing management: [Shopify](https://mobbin.com/screens/e065d8db-659e-44b7-b4d0-1ed9e9da485c) and Etsy. Selected status tabs, explicit actions and visible rejection feedback. Rejected bulk enterprise controls.
- Moderation: [Reddit](https://mobbin.com/screens/c20fd251-fbfe-471b-b3a4-c0175cf1ada4), Circle and Klaviyo. Selected queue-to-detail review, full image inspection, history, internal rationale and a separate user-visible reason.
- Support: [Zendesk](https://mobbin.com/screens/9f1bd8d3-846d-40f5-bcf1-3a2c1e73e087), Gorgias, Plain and Featurebase. Selected a durable threaded ticket with a clear status, avoiding an empty “live chat” promise.

## Responsive and navigation decisions

Desktop uses a standard top bar. Mobile uses five primary items at most: Home, Browse, Sell, Chats and Account. Ordinary user flows do not use side drawers. Admin uses a compact section navigation that becomes horizontally scrollable on smaller screens. Product grids move from four to two and then one column; detail and chat split views collapse to single-column full pages.

## Form behavior

Inputs have persistent labels, inline accessible errors, native controls where suitable and visible focus. Price fields are mutually exclusive by selected price type; FAIR/POOR requires an explanation. Upload progress is attached to each selected image. Confirmation dialogs are reserved for destructive actions; creation/editing remains a full page.

## States

Queries render skeleton/loading, retryable error and content-specific empty states. Pending/rejected owners see status and moderation feedback. Public unauthorized access receives the same unavailable presentation. Status uses both text and color. Images reserve aspect ratio to prevent layout shift, lazy-load in grids and provide meaningful alt text.

## Rejected directions

Large promotional heroes, purple gradients, glass surfaces, animated dashboards, floating cards, fake activity, testimonials, deep filter trees, seller analytics on product cards and complicated multi-step onboarding were rejected as distracting or disproportionate for a student marketplace.
