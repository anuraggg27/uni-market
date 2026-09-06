import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Star } from "lucide-react";
import { api } from "../api";
import { ErrorState, Loading } from "./UI";
import { UserAvatar } from "./UserAvatar";

type ReputationReview = {
  id: string;
  reviewerName: string;
  reviewerAvatarId?: string | null;
  rating: number;
  text: string;
  createdAt?: string;
};

type BuyerFeedback = {
  averageRating: number;
  reviewCount: number;
  recentReviews: ReputationReview[];
};

function BuyerReviewStars({ rating }: { rating: number }) {
  return (
    <span className="profile-buyer-review-stars" role="img" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((value) => (
        <Star aria-hidden="true" className={value <= rating ? "is-filled" : ""} key={value} />
      ))}
    </span>
  );
}

export function BuyerReputation({ conversationId }: { conversationId: string }) {
  const query = useQuery({
    queryKey: ["buyer-reputation", conversationId],
    queryFn: () => api<BuyerFeedback>(`/api/conversations/${conversationId}/buyer-reputation`),
  });
  if (query.isPending) return <span>Loading buyer feedback...</span>;
  if (query.isError) return <button className="buyer-reputation-retry" onClick={() => void query.refetch()}>Retry buyer feedback</button>;
  const feedback = query.data;
  if (!feedback.reviewCount) return <span>No seller reviews yet.</span>;
  return (
    <details className="buyer-reputation">
      <summary>Buyer rating: {feedback.averageRating.toFixed(1)} &middot; {feedback.reviewCount} {feedback.reviewCount === 1 ? "review" : "reviews"}</summary>
      <section className="buyer-reputation-panel" aria-label="Buyer reviews from sellers">
        <h3>Reviews from sellers</h3>
        {feedback.recentReviews.map((review) => (
          <article key={review.id}>
            <div><b>{review.reviewerName}</b><small>{review.rating} out of 5</small></div>
            <p>{review.text}</p>
          </article>
        ))}
      </section>
    </details>
  );
}

export function BuyerReputationSection() {
  const query = useQuery({
    queryKey: ["my-buyer-reputation"],
    queryFn: () => api<BuyerFeedback>("/api/users/me/buyer-reputation"),
  });

  return (
    <section className="profile-buyer-reputation panel" aria-labelledby="buyer-reputation-heading">
      <header className="profile-buyer-reputation-heading">
        <div>
          <span className="profile-avatar-eyebrow">Buyer reputation</span>
          <h2 id="buyer-reputation-heading">Reviews from sellers</h2>
          <p>Feedback from sellers after your completed exchanges.</p>
        </div>
        {query.data?.reviewCount ? (
          <div className="profile-buyer-reputation-summary" aria-label="Buyer rating">
            <strong>{Number(query.data.averageRating).toFixed(1)}</strong>
            <Star aria-hidden="true" />
            <span>{query.data.reviewCount} {query.data.reviewCount === 1 ? "review" : "reviews"} from sellers</span>
          </div>
        ) : null}
      </header>

      {query.isPending ? (
        <Loading label="Loading buyer reputation" />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : query.data.reviewCount ? (
        <div className="profile-buyer-review-list">
          {query.data.recentReviews.map((review) => (
            <article className="profile-buyer-review" key={review.id}>
              <header>
                <UserAvatar
                  avatarId={review.reviewerAvatarId ?? null}
                  displayName={review.reviewerName}
                  size={38}
                  className="profile-buyer-review-avatar"
                />
                <div>
                  <strong>{review.reviewerName}</strong>
                  <span><BadgeCheck aria-hidden="true" />Verified exchange</span>
                </div>
                <BuyerReviewStars rating={review.rating} />
              </header>
              <p>{review.text}</p>
              <footer>
                {review.createdAt ? (
                  <time dateTime={review.createdAt}>
                    {new Date(review.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </time>
                ) : null}
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <p className="profile-buyer-reputation-empty">No seller reviews yet.</p>
      )}
    </section>
  );
}
