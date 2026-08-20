import React from 'react';
import { ImageOff, MapPin } from 'lucide-react';
import { Link } from 'react-router-dom';
import { StatusBadge } from './UI';

export function ProductCard({ listing }: { listing: any }) {
  return <article className="product-card"><Link to={`/listing/${listing.id}`} aria-label={`View ${listing.title}`}>{listing.coverImageUrl ? <img className="product-image" src={listing.coverImageUrl} alt={listing.title} loading="lazy" width={640} height={480}/> : <div className="product-image image-placeholder"><ImageOff aria-hidden="true"/><span>No image</span></div>}{listing.lifecycleState !== 'ACTIVE' ? <span className="card-status"><StatusBadge value={listing.lifecycleState}/></span> : null}<h3>{listing.title}</h3><div className="price">{listing.priceLabel ?? price(listing)}</div><div className="meta"><span>{String(listing.condition).replaceAll('_',' ')}</span><span><MapPin width={13} aria-hidden="true"/> {listing.location}</span></div></Link></article>;
}
function price(item: any) { if (item.priceType === 'FREE') return 'Free'; if (item.priceType === 'RANGE') return `₹${item.minimumPrice?.toLocaleString('en-IN')}–₹${item.maximumPrice?.toLocaleString('en-IN')}`; return `₹${item.exactPrice?.toLocaleString('en-IN')}`; }
