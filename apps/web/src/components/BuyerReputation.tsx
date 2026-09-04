import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

type BuyerFeedback = {
  averageRating: number;
  reviewCount: number;
  recentReviews: { id: string; reviewerName: string; rating: number; text: string }[];
};

export function BuyerReputation({ conversationId }: { conversationId: string }) {
  const query = useQuery({
    queryKey: ["buyer-reputation", conversationId],
    queryFn: () => api<BuyerFeedback>(`/api/conversations/${conversationId}/buyer-reputation`),
  });
  if (query.isPending) return <span>Loading buyer feedback…</span>;
  if (query.isError) return <button className="buyer-reputation-retry" onClick={() => void query.refetch()}>Retry buyer feedback</button>;
  const feedback = query.data;
  if (!feedback.reviewCount) return <span>No buyer reviews yet</span>;
  return (
    <details className="buyer-reputation">
      <summary>Buyer rating: {feedback.averageRating.toFixed(1)} · {feedback.reviewCount} {feedback.reviewCount === 1 ? "review" : "reviews"}</summary>
      <section className="buyer-reputation-panel" aria-label="Buyer reviews from sellers">
        <h3>Buyer reviews from sellers</h3>
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
